use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};

type AppResult = Result<Json<Value>, ApiError>;
type DraftMap = BTreeMap<String, Value>;

#[derive(Clone, Default, Deserialize)]
struct Credentials {
    #[serde(default)]
    token: String,
    #[serde(default)]
    cookie: String,
    #[serde(default = "default_project", rename = "projectId")]
    project_id: u64,
}
fn default_project() -> u64 {
    8340
}

struct CachedSuggestion {
    at: Instant,
    data: Value,
}
struct AppState {
    client: Client,
    base_url: String,
    secret: String,
    credentials: RwLock<Option<Credentials>>,
    drafts: Mutex<DraftMap>,
    draft_path: PathBuf,
    suggestions: Mutex<BTreeMap<String, CachedSuggestion>>,
    suggestion_gate: Mutex<()>,
}

#[derive(Debug, Serialize)]
struct ApiError {
    #[serde(skip)]
    status: StatusCode,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<Value>,
}
impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            code: None,
        }
    }
    fn invalid(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(&self)).into_response()
    }
}

fn id(value: &Value, name: &str) -> Result<u64, ApiError> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .filter(|v| *v > 0 && *v <= i32::MAX as u64)
        .ok_or_else(|| ApiError::invalid(format!("无效的 {name}")))
}
fn stage(value: &Value) -> Result<i64, ApiError> {
    let stage = value
        .get("stage")
        .and_then(Value::as_i64)
        .ok_or_else(|| ApiError::invalid("请选择词条状态"))?;
    if [0, 1, 2, 3, 5, 9, -1].contains(&stage) {
        Ok(stage)
    } else {
        Err(ApiError::invalid("无效的词条状态"))
    }
}
fn translation(value: &Value) -> Result<String, ApiError> {
    let text = value
        .get("translation")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::invalid("译文必须为文本"))?;
    if text.len() > 1_000_000 {
        return Err(ApiError::invalid("译文过长"));
    }
    Ok(text.to_owned())
}

fn term_snapshot(value: &Value) -> Value {
    json!({
        "term": value.get("term").and_then(Value::as_str).unwrap_or(""),
        "translation": value.get("translation").and_then(Value::as_str).unwrap_or(""),
        "pos": value.get("pos").and_then(Value::as_str).unwrap_or(""),
        "note": value.get("note").and_then(Value::as_str).unwrap_or(""),
        "variants": value.get("variants").and_then(Value::as_array).cloned().unwrap_or_default(),
        "caseSensitive": value.get("caseSensitive").and_then(Value::as_bool).unwrap_or(false)
    })
}

fn term_body(payload: &Value) -> Result<Value, ApiError> {
    let term = payload.get("term").and_then(Value::as_str).unwrap_or("");
    let translation = payload.get("translation").and_then(Value::as_str).unwrap_or("");
    let note = payload.get("note").and_then(Value::as_str).unwrap_or("");
    let pos = payload.get("pos").and_then(Value::as_str).unwrap_or("");
    if term.trim().is_empty() || translation.trim().is_empty() || term.len() > 4000 || translation.len() > 16000 || note.len() > 50000 {
        return Err(ApiError::invalid("请填写有效的术语原文和译文"));
    }
    if !["", "noun", "verb", "adj", "adv"].contains(&pos) {
        return Err(ApiError::invalid("无效的术语词性"));
    }
    let variants = payload.get("variants").and_then(Value::as_array)
        .ok_or_else(|| ApiError::invalid("术语变体必须为文本列表"))?;
    if variants.len() > 100 || variants.iter().any(|variant| variant.as_str().is_none_or(|text| text.trim().is_empty() || text.len() > 4000)) {
        return Err(ApiError::invalid("术语变体无效或过多"));
    }
    let mut body = json!({"term":term,"translation":translation,"note":note,"variants":variants,
        "caseSensitive":payload.get("caseSensitive").and_then(Value::as_bool).unwrap_or(false)});
    if !pos.is_empty() { body["pos"] = json!(pos); }
    Ok(body)
}

async fn authorize(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if headers.get("x-sckit-key").and_then(|v| v.to_str().ok()) != Some(state.secret.as_str()) {
        return ApiError::new(StatusCode::UNAUTHORIZED, "未授权的本地服务请求").into_response();
    }
    next.run(request).await
}

async fn remote(
    state: &AppState,
    credentials: &Credentials,
    method: Method,
    path: &str,
    query: &[(String, String)],
    body: Option<Value>,
) -> Result<Value, ApiError> {
    let mut request = state
        .client
        .request(method, format!("{}{path}", state.base_url))
        .query(query);
    if !credentials.token.is_empty() {
        let token = credentials.token.trim();
        let auth = if token.to_ascii_lowercase().starts_with("bearer ") {
            token.to_owned()
        } else {
            format!("Bearer {token}")
        };
        let header =
            HeaderValue::from_str(&auth).map_err(|_| ApiError::invalid("Token 格式无效"))?;
        request = request.header("Authorization", header);
    } else if !credentials.cookie.is_empty() {
        let header = HeaderValue::from_str(&credentials.cookie)
            .map_err(|_| ApiError::invalid("登录会话无效"))?;
        request = request.header("Cookie", header);
    } else {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "请先登录 ParaTranz 或连接 API Token",
        ));
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|error| {
        let message = if error.is_timeout() {
            "ParaTranz 请求超时，请稍后重试"
        } else {
            "无法连接 ParaTranz，请检查网络或系统代理"
        };
        ApiError::new(StatusCode::BAD_GATEWAY, message)
    })?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "读取 ParaTranz 响应失败"))?;
    let data: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let default_message = match status.as_u16() {
            401 => "登录已过期，请重新连接",
            403 => "当前账户没有此操作的权限",
            423 => "文件或词条被锁定，请稍后再试",
            429 => "请求过于频繁，请稍后再试",
            _ => "ParaTranz 请求失败",
        };
        let mut error = ApiError::new(
            status,
            data.get("message")
                .and_then(Value::as_str)
                .unwrap_or(default_message),
        );
        error.code = data.get("code").cloned();
        return Err(error);
    }
    if data.is_null() && !text.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "ParaTranz 返回了非 JSON 响应",
        ));
    }
    Ok(data)
}

async fn health() -> Json<Value> {
    Json(json!({"status":"ready", "version":env!("CARGO_PKG_VERSION")}))
}

async fn connect(
    State(state): State<Arc<AppState>>,
    Json(credentials): Json<Credentials>,
) -> AppResult {
    if credentials.project_id > i32::MAX as u64
        || credentials.token.len() > 16384
        || credentials.cookie.len() > 16384
    {
        return Err(ApiError::invalid("连接参数无效"));
    }
    // Authenticate the account before choosing a project or replacing a working connection.
    let account = remote(&state, &credentials, Method::GET, "/account", &[], None).await?;
    let user = account.get("user").unwrap_or(&account);
    if user.get("id").and_then(Value::as_u64).filter(|id| *id > 0).is_none() {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "未能确认 ParaTranz 登录账号，请重新登录"));
    }
    // Older callers can still ask to validate access to a specific project.
    if credentials.project_id > 0 {
        remote(
            &state,
            &credentials,
            Method::GET,
            &format!("/projects/{}", credentials.project_id),
            &[],
            None,
        )
        .await?;
        // Project metadata is public, even with an invalid token. Verify a protected read.
        remote(
            &state,
            &credentials,
            Method::GET,
            &format!("/projects/{}/strings", credentials.project_id),
            &[
                ("pageSize".into(), "1".into()),
                ("detailed".into(), "0".into()),
            ],
            None,
        )
        .await?;
    }
    let user = account.get("user").cloned().unwrap_or(account);
    let mode = if credentials.token.is_empty() {
        "session"
    } else {
        "token"
    };
    *state.credentials.write().await = Some(credentials);
    state.suggestions.lock().await.clear();
    Ok(Json(json!({"authenticated":true,"mode":mode,"user":user})))
}

async fn disconnect(State(state): State<Arc<AppState>>) -> AppResult {
    *state.credentials.write().await = None;
    state.suggestions.lock().await.clear();
    Ok(Json(json!({"authenticated":false,"mode":"none"})))
}

// Only Electron can call this authenticated sidecar endpoint. Never expose it through renderer RPC.
async fn presence_connection(State(state): State<Arc<AppState>>, Json(payload): Json<Value>) -> AppResult {
    let credentials = state.credentials.read().await.clone()
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "请先登录 ParaTranz"))?;
    let cookie = payload.get("cookie").and_then(Value::as_str).filter(|value| !value.is_empty())
        .unwrap_or(&credentials.cookie);
    if cookie.is_empty() {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "占用同步需要网页登录，API Token 连接仍可正常翻译"));
    }
    if cookie.len() > 16384 || cookie.contains(['\r', '\n']) {
        return Err(ApiError::invalid("登录会话无效"));
    }
    let account = remote(&state, &credentials, Method::GET, "/account", &[], None).await?;
    let user = account.get("user").unwrap_or(&account);
    let uid = user.get("id").and_then(Value::as_u64)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "无法获取当前用户"))?;
    let web_credentials = Credentials { token: String::new(), cookie: cookie.to_owned(), project_id: credentials.project_id };
    let web_account = remote(&state, &web_credentials, Method::GET, "/account", &[], None).await?;
    let web_user = web_account.get("user").unwrap_or(&web_account);
    if web_user.get("id").and_then(Value::as_u64) != Some(uid) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "请使用与当前 API 连接相同的 ParaTranz 账号登录"));
    }
    Ok(Json(json!({"userId":uid,"headers":{"Cookie":cookie}})))
}

async fn write_drafts(state: &AppState, drafts: &DraftMap) -> Result<(), ApiError> {
    if let Some(parent) = state.draft_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "无法创建草稿目录"))?;
    }
    let bytes = serde_json::to_vec(drafts)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "草稿序列化失败"))?;
    let temp = state.draft_path.with_extension("tmp");
    tokio::fs::write(&temp, bytes)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "无法写入本地草稿"))?;
    // Windows rename cannot overwrite an existing file. A backup preserves the previous snapshot.
    let backup = state.draft_path.with_extension("bak");
    if state.draft_path.exists() {
        let _ = tokio::fs::remove_file(&backup).await;
        tokio::fs::rename(&state.draft_path, &backup)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "无法备份本地草稿"))?;
    }
    if tokio::fs::rename(&temp, &state.draft_path).await.is_err() {
        if backup.exists() {
            let _ = tokio::fs::rename(backup, &state.draft_path).await;
        }
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "保存本地草稿失败",
        ));
    }
    Ok(())
}

async fn cached_suggestions(
    state: &AppState,
    credentials: &Credentials,
    project: u64,
    string: u64,
) -> Result<Value, ApiError> {
    let key = format!("{project}/{string}");
    // One global gate enforces ParaTranz's documented serial-call rule, even across windows.
    let _gate = state.suggestion_gate.lock().await;
    if let Some(cached) = state
        .suggestions
        .lock()
        .await
        .get(&key)
        .filter(|c| c.at.elapsed() < Duration::from_secs(30))
    {
        return Ok(cached.data.clone());
    }
    let data = remote(
        state,
        credentials,
        Method::GET,
        &format!("/projects/{project}/strings/{string}/suggestions"),
        &[("rate".into(), "0".into())],
        None,
    )
    .await?;
    let mut cache = state.suggestions.lock().await;
    cache.retain(|_, item| item.at.elapsed() < Duration::from_secs(30));
    cache.insert(
        key,
        CachedSuggestion {
            at: Instant::now(),
            data: data.clone(),
        },
    );
    Ok(data)
}

async fn rpc(
    State(state): State<Arc<AppState>>,
    Path(action): Path<String>,
    Json(payload): Json<Value>,
) -> AppResult {
    if action == "session" {
        let credentials = state.credentials.read().await.clone();
        if let Some(credentials) = credentials {
            let account = remote(&state, &credentials, Method::GET, "/account", &[], None).await?;
            let user = account.get("user").unwrap_or(&account);
            id(user, "id")?;
            return Ok(Json(json!({"authenticated":true,"mode":if credentials.token.is_empty(){"session"}else{"token"},"user":user})));
        }
        return Ok(Json(json!({"authenticated":false,"mode":"none"})));
    }
    if action == "drafts" {
        return Ok(Json(
            serde_json::to_value(&*state.drafts.lock().await).unwrap_or(json!({})),
        ));
    }
    let project = if action == "projects" { 0 } else { id(&payload, "projectId")? };
    if action == "draft" {
        let string = id(&payload, "stringId")?;
        let key = format!("{project}/{string}");
        let mut drafts = state.drafts.lock().await;
        let mut next = drafts.clone();
        if payload.get("remove").and_then(Value::as_bool) == Some(true) {
            next.remove(&key);
        } else {
            next.insert(key, json!({"translation":translation(&payload)?,"stage":stage(&payload)?,"updatedAt":payload.get("updatedAt")}));
        }
        write_drafts(&state, &next).await?;
        *drafts = next;
        return Ok(Json(json!({"saved":true})));
    }
    let credentials = state
        .credentials
        .read()
        .await
        .clone()
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "请先连接 ParaTranz"))?;
    let mut query: Vec<(String, String)> = vec![];
    let project_path = format!("/projects/{project}");
    let data = match action.as_str() {
        "projects" => {
            let account = remote(&state, &credentials, Method::GET, "/account", &[], None).await?;
            let user = account.get("user").unwrap_or(&account);
            let uid = id(user, "id")?;
            let memberships = remote(&state, &credentials, Method::GET, &format!("/users/{uid}/projects"), &[], None).await?;
            let rows = memberships.as_array().ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "项目列表格式无效"))?;
            Value::Array(rows.iter().filter_map(|entry| {
                let summary = entry.get("project")?;
                Some(json!({"id":summary.get("id")?, "name":summary.get("name")?, "permission":entry.get("permission"), "privacy":summary.get("privacy")}))
            }).collect())
        }
        "project" => remote(&state, &credentials, Method::GET, &project_path, &[], None).await?,
        "updateProject" => {
            let name = payload.get("name").and_then(Value::as_str).unwrap_or("").trim();
            let desc = payload.get("desc").and_then(Value::as_str).unwrap_or("");
            if name.is_empty() || name.len() > 500 || desc.len() > 50000 { return Err(ApiError::invalid("项目名称或说明长度无效")); }
            let existing = remote(&state, &credentials, Method::GET, &project_path, &[], None).await?;
            if existing.get("name").and_then(Value::as_str) != payload.get("expectedName").and_then(Value::as_str) || existing.get("desc").and_then(Value::as_str).unwrap_or("") != payload.get("expectedDesc").and_then(Value::as_str).unwrap_or("") {
                return Err(ApiError::new(StatusCode::CONFLICT, "项目资料已被修改，请刷新后重试"));
            }
            remote(&state, &credentials, Method::PUT, &project_path, &[], Some(json!({"name":name,"desc":desc}))).await?
        }
        "renameFile" => {
            let name = payload.get("name").and_then(Value::as_str).unwrap_or("").trim();
            if name.is_empty() || name.len() > 1000 || name.starts_with('/') || name.contains('\\') || name.chars().any(char::is_control) || name.split('/').any(|part| part.is_empty() || part == "." || part == "..") { return Err(ApiError::invalid("请填写有效的完整文件路径，使用 / 分隔目录")); }
            let path = format!("{project_path}/files/{}", id(&payload, "fileId")?);
            let existing = remote(&state, &credentials, Method::GET, &path, &[], None).await?;
            if existing.get("name").and_then(Value::as_str) != payload.get("expectedName").and_then(Value::as_str) { return Err(ApiError::new(StatusCode::CONFLICT, "文件已被重命名，请刷新后重试")); }
            remote(&state, &credentials, Method::PUT, &path, &[], Some(json!({"name":name}))).await?
        }
        "files" => {
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("{project_path}/files"),
                &[],
                None,
            )
            .await?
        }
        "file" => {
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("{project_path}/files/{}", id(&payload, "fileId")?),
                &[],
                None,
            )
            .await?
        }
        "strings" => {
            let page = payload
                .get("page")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 100000);
            let size = payload
                .get("pageSize")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .clamp(1, 800);
            query.extend([
                ("page".into(), page.to_string()),
                ("pageSize".into(), size.to_string()),
                ("detailed".into(), "1".into()),
            ]);
            if payload.get("fileId").and_then(Value::as_u64).unwrap_or(0) > 0 {
                query.push(("file".into(), id(&payload, "fileId")?.to_string()));
            }
            if payload.get("stage").is_some_and(|s| !s.is_null()) {
                query.push(("stage".into(), stage(&payload)?.to_string()));
            }
            if let Some(text) = payload
                .get("text")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                if text.len() > 1000 {
                    return Err(ApiError::invalid("搜索文本过长"));
                }
                let mode = payload
                    .get("searchMode")
                    .and_then(Value::as_str)
                    .unwrap_or("text");
                if !["text", "original", "translation", "key", "context"].contains(&mode) {
                    return Err(ApiError::invalid("无效的搜索范围"));
                }
                query.push((mode.into(), text.into()));
            }
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("{project_path}/strings"),
                &query,
                None,
            )
            .await?
        }
        "string" => {
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("{project_path}/strings/{}", id(&payload, "stringId")?),
                &[("detailed".into(), "1".into())],
                None,
            )
            .await?
        }
        "terms" => {
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("{project_path}/strings/{}/terms", id(&payload, "stringId")?),
                &[],
                None,
            )
            .await?
        }
        "projectTerms" => {
            let page = payload.get("page").and_then(Value::as_u64).unwrap_or(1).clamp(1, 100000);
            let size = payload.get("pageSize").and_then(Value::as_u64).unwrap_or(800).clamp(1, 800);
            remote(&state, &credentials, Method::GET, &format!("{project_path}/terms"),
                &[("page".into(),page.to_string()),("pageSize".into(),size.to_string())], None).await?
        }
        "term" => {
            remote(&state, &credentials, Method::GET,
                &format!("{project_path}/terms/{}", id(&payload,"termId")?), &[], None).await?
        }
        "createTerm" => {
            let body = term_body(&payload)?;
            remote(&state, &credentials, Method::POST, &format!("{project_path}/terms"), &[], Some(body)).await?
        }
        "updateTerm" | "deleteTerm" => {
            let path = format!("{project_path}/terms/{}", id(&payload,"termId")?);
            let expected = payload.get("expected").filter(|value| value.is_object())
                .ok_or_else(|| ApiError::invalid("缺少术语原始版本，请重新打开编辑"))?;
            let body = if action == "updateTerm" { Some(term_body(&payload)?) } else { None };
            let current = remote(&state, &credentials, Method::GET, &path, &[], None).await?;
            if term_snapshot(&current) != term_snapshot(expected) || current.get("updatedAt") != expected.get("updatedAt") {
                return Err(ApiError::new(StatusCode::CONFLICT,"术语已被其他用户修改，请重新载入后再操作"));
            }
            if action == "deleteTerm" {
                remote(&state, &credentials, Method::DELETE, &path, &[], None).await?;
                json!({"deleted":true})
            } else {
                remote(&state, &credentials, Method::PUT, &path, &[], body).await?
            }
        }
        "suggestions" => {
            cached_suggestions(&state, &credentials, project, id(&payload, "stringId")?).await?
        }
        "memory" => {
            let text = payload.get("text").and_then(Value::as_str).unwrap_or("").trim();
            if text.is_empty() || text.len() > 1000 {
                return Err(ApiError::invalid("请输入不超过 1000 字节的搜索文本"));
            }
            let field = payload.get("field").and_then(Value::as_str).unwrap_or("");
            if !["", "original", "translation", "key"].contains(&field) {
                return Err(ApiError::invalid("无效的历史翻译搜索范围"));
            }
            query.extend([
                ("projectId".into(), project.to_string()),
                ("text".into(), text.into()),
                ("field".into(), field.into()),
            ]);
            // projectId supplies the editor context; omit the project-only filter for global search.
            remote(&state, &credentials, Method::GET, "/memory", &query, None).await?
        }
        "history" => {
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("{project_path}/history"),
                &[
                    ("tid".into(), id(&payload, "stringId")?.to_string()),
                    ("pageSize".into(), "50".into()),
                ],
                None,
            )
            .await?
        }
        "save" => {
            if let Some(expected_user) = payload.get("expectedUserId") {
                let account = remote(&state, &credentials, Method::GET, "/users/my", &[], None).await?;
                let user = account.get("user").unwrap_or(&account);
                if expected_user != user.get("id").unwrap_or(&Value::Null) {
                    return Err(ApiError::new(StatusCode::CONFLICT, "登录账号已变更，未上传此词条。本地草稿已保留。"));
                }
            }
            let string = id(&payload, "stringId")?;
            let target = format!("{project_path}/strings/{string}");
            let current = remote(&state, &credentials, Method::GET, &target, &[], None).await?;
            for (expected, field) in [
                ("expectedUpdatedAt", "updatedAt"),
                ("expectedTranslation", "translation"),
                ("expectedStage", "stage"),
                ("expectedOriginal", "original"),
            ] {
                let provided = payload
                    .get(expected)
                    .ok_or_else(|| ApiError::invalid("缺少远端版本信息，请重新载入词条"))?;
                if provided != current.get(field).unwrap_or(&Value::Null) {
                    return Err(ApiError::new(
                        StatusCode::CONFLICT,
                        "这条词条已被其他人修改。请重新载入后合并译文；本地草稿已保留。",
                    ));
                }
            }
            let body = json!({"translation":translation(&payload)?,"stage":stage(&payload)?});
            let saved = remote(&state, &credentials, Method::PUT, &target, &[], Some(body)).await?;
            state.suggestions.lock().await.clear();
            if saved.is_null() {
                remote(&state, &credentials, Method::GET, &target, &[], None).await?
            } else {
                saved
            }
        }
        _ => return Err(ApiError::new(StatusCode::NOT_FOUND, "不存在的服务操作")),
    };
    Ok(Json(data))
}

fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/credentials", post(connect).delete(disconnect))
        .route("/internal/presence", post(presence_connection))
        .route("/rpc/{action}", post(rpc))
        .layer(DefaultBodyLimit::max(2_000_000))
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let secret = std::env::var("SCKIT_SECRET")
        .map_err(|_| "SCKIT_SECRET is required; launch this service from Electron")?;
    if secret.len() < 32 {
        return Err("SCKIT_SECRET must contain at least 32 characters".into());
    }
    let data_dir =
        PathBuf::from(std::env::var("SCKIT_DATA_DIR").unwrap_or_else(|_| "local-data".into()));
    let draft_path = data_dir.join("drafts.json");
    let drafts = tokio::fs::read(&draft_path)
        .await
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .or_else(|| {
            std::fs::read(draft_path.with_extension("bak"))
                .ok()
                .and_then(|v| serde_json::from_slice(&v).ok())
        })
        .unwrap_or_default();
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(45))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("ScTranslateKit/0.1.0");
    if let Ok(proxy) = std::env::var("SCKIT_PROXY") {
        if !proxy.is_empty() {
            builder = builder.proxy(reqwest::Proxy::all(proxy)?);
        }
    }
    let state = Arc::new(AppState {
        client: builder.build()?,
        base_url: "https://paratranz.cn/api".into(),
        secret,
        credentials: RwLock::new(None),
        drafts: Mutex::new(drafts),
        draft_path,
        suggestions: Mutex::new(BTreeMap::new()),
        suggestion_gate: Mutex::new(()),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    println!(
        "{}",
        json!({"port":listener.local_addr()?.port(),"status":"ready"})
    );
    axum::serve(listener, router(state)).await?;
    Ok(())
}

#[cfg(test)]
mod tests;
