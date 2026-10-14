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
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{Arc, atomic::{AtomicU64, Ordering}},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, RwLock, Semaphore};
use tokio::io::AsyncWriteExt;

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
struct McpOperation {
    policy_version: u64,
    cancelled: bool,
    submitted: bool,
    started: Instant,
}
struct AppState {
    client: Client,
    base_url: String,
    secret: String,
    credentials: RwLock<Option<Credentials>>,
    active_account_id: RwLock<Option<u64>>,
    connection_epoch: AtomicU64,
    mcp_policy_version: AtomicU64,
    mcp_operations: Mutex<BTreeMap<String, McpOperation>>,
    save_gate: Mutex<()>,
    remote_gate: Semaphore,
    drafts: Mutex<DraftMap>,
    draft_path: PathBuf,
    suggestions: Mutex<BTreeMap<String, CachedSuggestion>>,
    suggestion_gate: Mutex<()>,
}

// Electron alone can issue leases. Revocation and dispatch use the same lock,
// so cancellation accepted before dispatch cannot become a later write.
async fn mcp_operation(State(state): State<Arc<AppState>>, Json(payload): Json<Value>) -> AppResult {
    let mut operations = state.mcp_operations.lock().await;
    operations.retain(|_, operation| operation.started.elapsed() < Duration::from_secs(300));
    let action = payload.get("action").and_then(Value::as_str).unwrap_or("");
    if action == "policy" {
        let version = payload.get("policyVersion").and_then(Value::as_u64).ok_or_else(|| ApiError::invalid("MCP 权限版本无效"))?;
        if version < state.mcp_policy_version.load(Ordering::SeqCst) { return Err(ApiError::invalid("MCP 权限版本已失效")); }
        state.mcp_policy_version.store(version, Ordering::SeqCst);
        for operation in operations.values_mut() { operation.cancelled = true; }
        return Ok(Json(json!({"applied":true})));
    }
    let key = payload.get("operationId").and_then(Value::as_str).filter(|key| key.len() == 36 && key.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-'))
        .ok_or_else(|| ApiError::invalid("MCP 操作 ID 无效"))?;
    match action {
        "begin" => {
            let version = payload.get("policyVersion").and_then(Value::as_u64).ok_or_else(|| ApiError::invalid("MCP 权限版本无效"))?;
            if version != state.mcp_policy_version.load(Ordering::SeqCst) { return Err(ApiError::new(StatusCode::CONFLICT, "MCP 权限已变更")); }
            if operations.len() >= 128 { return Err(ApiError::new(StatusCode::TOO_MANY_REQUESTS, "MCP 正在处理的任务过多")); }
            if operations.contains_key(key) { return Err(ApiError::invalid("MCP 操作 ID 已使用")); }
            operations.insert(key.to_owned(), McpOperation { policy_version: version, cancelled: false, submitted: false, started: Instant::now() });
            Ok(Json(json!({"registered":true})))
        }
        "cancel" => {
            let submitted = operations.get_mut(key).map(|operation| { operation.cancelled = true; operation.submitted }).unwrap_or(false);
            Ok(Json(json!({"cancelled":true,"alreadySubmitted":submitted})))
        }
        "finish" => { operations.remove(key); Ok(Json(json!({"finished":true}))) }
        _ => Err(ApiError::invalid("MCP 操作无效")),
    }
}

async fn begin_mcp_commit(state: &AppState, payload: &Value) -> Result<(), ApiError> {
    if let Some(key) = payload.get("mcpOperationId") {
        let key = key.as_str().ok_or_else(|| ApiError::invalid("MCP 操作 ID 无效"))?;
        let mut operations = state.mcp_operations.lock().await;
        let operation = operations.get_mut(key).ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "MCP 操作已失效，未提交"))?;
        if operation.cancelled || operation.started.elapsed() >= Duration::from_secs(300)
            || payload.get("mcpPolicyVersion").and_then(Value::as_u64) != Some(operation.policy_version)
            || operation.policy_version != state.mcp_policy_version.load(Ordering::SeqCst) {
            return Err(ApiError::new(StatusCode::CONFLICT, "MCP 操作已取消或权限已变更，未提交"));
        }
        check_expected_epoch(state, payload)?;
        operation.submitted = true;
    } else { check_expected_epoch(state, payload)?; }
    Ok(())
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

fn check_connection_epoch(state: &AppState, epoch: u64) -> Result<(), ApiError> {
    if state.connection_epoch.load(Ordering::SeqCst) != epoch {
        return Err(ApiError::new(StatusCode::CONFLICT, "ParaTranz 连接已变更，尚未提交的操作已停止"));
    }
    Ok(())
}

fn check_expected_epoch(state: &AppState, payload: &Value) -> Result<(), ApiError> {
    if let Some(value) = payload.get("expectedConnectionEpoch") {
        let epoch = value.as_u64().ok_or_else(|| ApiError::invalid("连接版本无效"))?;
        check_connection_epoch(state, epoch)?;
    }
    Ok(())
}

async fn check_save_account(state: &AppState, epoch: u64, payload: &Value) -> Result<(), ApiError> {
    check_expected_epoch(state, payload)?;
    if let Some(value) = payload.get("expectedUserId") {
        let account = value.as_u64().filter(|id| *id > 0).ok_or_else(|| ApiError::invalid("账号无效"))?;
        // This ID was authenticated by /account when the current credentials were committed.
        // Re-querying /users/my for every string neither adds identity isolation nor prevents races.
        if *state.active_account_id.read().await != Some(account) {
            return Err(ApiError::new(StatusCode::CONFLICT, "登录账号已变更，未上传此词条。本地草稿已保留。"));
        }
    }
    check_connection_epoch(state, epoch)
}

fn check_draft_version(drafts: &DraftMap, key: &str, payload: &Value) -> Result<(), ApiError> {
    for (expected, field) in [("expectedDraftUpdatedAt", "updatedAt"), ("expectedDraftTranslation", "translation"), ("expectedDraftStage", "stage")] {
        if let Some(value) = payload.get(expected) {
            let current = drafts.get(key).and_then(|draft| draft.get(field)).unwrap_or(&Value::Null);
            if value != current {
                return Err(ApiError::new(StatusCode::CONFLICT, "本机草稿已在读取后变化，请重新读取后再操作"));
            }
        }
    }
    Ok(())
}

fn batch_items(payload: &Value) -> Result<&[Value], ApiError> {
    let items = payload.get("items").and_then(Value::as_array)
        .filter(|items| !items.is_empty() && items.len() <= 25)
        .ok_or_else(|| ApiError::invalid("批量任务需包含 1 到 25 个词条"))?;
    let mut seen = BTreeSet::new();
    for item in items {
        if !seen.insert(id(item, "stringId")?) { return Err(ApiError::invalid("批量任务中的词条 ID 不得重复")); }
    }
    Ok(items)
}

async fn draft_batch(state: &AppState, project: u64, payload: &Value) -> AppResult {
    let account = id(payload, "accountId")?;
    let items = batch_items(payload)?;
    let active_account = state.active_account_id.read().await;
    if *active_account != Some(account) { return Err(ApiError::new(StatusCode::FORBIDDEN, "草稿账号与当前登录账号不一致")); }
    let mut drafts = state.drafts.lock().await;
    check_expected_epoch(state, payload)?;
    let mut next = drafts.clone();
    let mut results = Vec::new();
    let mut changed = false;
    for item in items {
        let string = id(item, "stringId")?;
        let key = format!("{account}/{project}/{string}");
        let prepared = (|| -> Result<Option<Value>, ApiError> {
            check_draft_version(&drafts, &key, item)?;
            if item.get("remove").and_then(Value::as_bool) == Some(true) { return Ok(None); }
            Ok(Some(json!({"translation":translation(item)?,"stage":stage(item)?,"updatedAt":item.get("updatedAt")})))
        })();
        match prepared {
            Ok(Some(draft)) => { next.insert(key, draft); changed = true; results.push(json!({"stringId":string,"saved":true})); }
            Ok(None) => { changed |= next.remove(&key).is_some(); results.push(json!({"stringId":string,"saved":true})); }
            Err(error) => results.push(json!({"stringId":string,"saved":false,"status":error.status.as_u16(),"message":error.message})),
        }
    }
    if changed { begin_mcp_commit(state, payload).await?; write_drafts(state, &next).await?; *drafts = next; }
    Ok(Json(json!({"results":results})))
}

async fn prepare_batch_save(state: &AppState, credentials: &Credentials, epoch: u64, project: u64, item: &Value, account: u64) -> Result<Value, ApiError> {
    let string = id(item, "stringId")?;
    let translation = translation(item)?;
    let stage = stage(item)?;
    if ![0, 1, 2, 3, 5].contains(&stage) { return Err(ApiError::invalid("批量直存不能锁定或隐藏词条")); }
    check_connection_epoch(state, epoch)?;
    let current = remote(state, credentials, Method::GET, &format!("/projects/{project}/strings/{string}"), &[], None).await?;
    if current.get("id").and_then(Value::as_u64) != Some(string) {
        return Err(ApiError::new(StatusCode::BAD_GATEWAY, "ParaTranz 返回了不匹配的词条"));
    }
    for (expected, field) in [("expectedUpdatedAt", "updatedAt"), ("expectedTranslation", "translation"), ("expectedStage", "stage"), ("expectedOriginal", "original")] {
        let provided = item.get(expected).ok_or_else(|| ApiError::invalid("缺少远端版本信息，请重新载入词条"))?;
        if provided != current.get(field).unwrap_or(&Value::Null) {
            return Err(ApiError::new(StatusCode::CONFLICT, "ParaTranz 词条已被修改，请重新读取后再提交"));
        }
    }
    if matches!(current.get("stage").and_then(Value::as_i64), Some(9 | -1)) {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "已锁定或隐藏的词条不能提交"));
    }
    let drafts = state.drafts.lock().await;
    check_draft_version(&drafts, &format!("{account}/{project}/{string}"), item)?;
    check_connection_epoch(state, epoch)?;
    Ok(json!({"id":string,"translation":translation,"stage":stage}))
}

async fn save_batch(state: Arc<AppState>, credentials: Credentials, epoch: u64, project: u64, payload: Value) -> AppResult {
    let _save = state.save_gate.lock().await;
    let account = id(&payload, "expectedUserId")?;
    check_save_account(&state, epoch, &payload).await?;
    let items = batch_items(&payload)?.to_vec();
    let gate = Arc::new(Semaphore::new(4));
    let mut workers = tokio::task::JoinSet::new();
    for (index, item) in items.iter().cloned().enumerate() {
        let state = state.clone();
        let credentials = credentials.clone();
        let gate = gate.clone();
        workers.spawn(async move {
            let _permit = gate.acquire_owned().await.expect("batch semaphore stays open");
            (index, prepare_batch_save(&state, &credentials, epoch, project, &item, account).await)
        });
    }
    let mut results = vec![Value::Null; items.len()];
    let mut accepted = Vec::new();
    while let Some(joined) = workers.join_next().await {
        let (index, prepared) = joined.map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "批量校验任务失败，未提交"))?;
        match prepared {
            Ok(body) => accepted.push((index, body)),
            Err(error) => results[index] = json!({"stringId":items[index]["stringId"],"saved":false,"status":error.status.as_u16(),"message":error.message}),
        }
    }
    check_save_account(&state, epoch, &payload).await?;
    {
        let drafts = state.drafts.lock().await;
        accepted.retain(|(index, _)| {
            let string = items[*index]["stringId"].as_u64().expect("validated string id");
            if let Err(error) = check_draft_version(&drafts, &format!("{account}/{project}/{string}"), &items[*index]) {
                results[*index] = json!({"stringId":string,"saved":false,"status":error.status.as_u16(),"message":error.message});
                false
            } else { true }
        });
    }
    if !accepted.is_empty() {
        check_connection_epoch(&state, epoch)?;
        let body = json!({"op":"edit","items":accepted.iter().map(|(_, body)| body.clone()).collect::<Vec<_>>()});
        begin_mcp_commit(&state, &payload).await?;
        check_connection_epoch(&state, epoch)?;
        let response = remote(&state, &credentials, Method::PUT, &format!("/projects/{project}/strings"), &[], Some(body)).await
            .map_err(|error| ApiError::new(error.status, format!("批量提交结果无法确认：{}。请先重新读取词条，不要直接重试", error.message)))?;
        let ids = response.as_array().ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "批量提交结果格式异常，请先重新读取词条，不要直接重试"))?;
        let mut saved_ids = BTreeSet::new();
        for value in ids {
            let string = value.as_u64().ok_or_else(|| ApiError::new(StatusCode::BAD_GATEWAY, "批量提交返回了无效 ID，请先重新读取词条"))?;
            if !accepted.iter().any(|(_, body)| body["id"].as_u64() == Some(string)) {
                return Err(ApiError::new(StatusCode::BAD_GATEWAY, "批量提交返回了非目标 ID，请先重新读取词条"));
            }
            saved_ids.insert(string);
        }
        for (index, body) in accepted {
            let string = body["id"].as_u64().expect("validated string id");
            results[index] = if saved_ids.contains(&string) { json!({"stringId":string,"saved":true}) }
                else { json!({"stringId":string,"saved":false,"message":"ParaTranz 未接受此词条，请重新读取后检查权限与状态"}) };
        }
        if !saved_ids.is_empty() { state.suggestions.lock().await.clear(); }
    }
    Ok(Json(json!({"results":results})))
}

fn string_filter_params(payload: &Value) -> Result<Vec<(String, String)>, ApiError> {
    let Some(params) = payload.get("filterParams").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    if params.len() > 64 {
        return Err(ApiError::invalid("筛选条件过多"));
    }
    let fields = ["text", "original", "translation", "key", "context"];
    let operators = ["=", "@=", "^=", "$=", "~=", "!=", "!@=", "!^=", "!$=", "!~="];
    let allowed = ["stage", "file", "fileLabel", "translateBy", "reviewBy", "uid", "filename", "orderBy", "createdAt>=", "createdAt<=", "updatedAt>=", "updatedAt<=", "advanced", "mode"];
    let mut result = Vec::with_capacity(params.len());
    for pair in params {
        let pair = pair.as_array().filter(|pair| pair.len() == 2)
            .ok_or_else(|| ApiError::invalid("筛选参数格式无效"))?;
        let key = pair[0].as_str().unwrap_or("");
        let value = pair[1].as_str().unwrap_or("");
        let condition_key = fields.iter().any(|field| key.strip_prefix(field).is_some_and(|operator| operators.contains(&operator)));
        if !(allowed.contains(&key) || condition_key) || key.len() > 40 || value.len() > 1000 {
            return Err(ApiError::invalid("筛选参数无效或过长"));
        }
        if key == "orderBy" && !["", "key", "-updatedAt"].contains(&value) {
            return Err(ApiError::invalid("无效的排序方式"));
        }
        // ParaTranz uses the operator's final `=` as the query key/value
        // separator (for example, `original^=text` has key `original^`).
        // Keep the editor-facing form above, then remove that separator from
        // the key before reqwest encodes it.
        let query_key = if condition_key
            || ["createdAt>=", "createdAt<=", "updatedAt>=", "updatedAt<="].contains(&key)
        {
            key.strip_suffix('=').unwrap_or(key)
        } else {
            key
        };
        result.push((query_key.to_owned(), value.to_owned()));
    }
    Ok(result)
}

fn encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
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
    let _permit = state.remote_gate.acquire().await.map_err(|_| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "ParaTranz 请求队列已关闭"))?;
    let is_delete = method == Method::DELETE;
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
    if is_delete {
        return Ok(Value::Null);
    }
    if data.is_null() && !text.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "ParaTranz 返回了非 JSON 响应",
        ));
    }
    Ok(data)
}

async fn download_artifact(
    state: &AppState,
    credentials: &Credentials,
    project: u64,
) -> Result<Value, ApiError> {
    let _permit = state.remote_gate.acquire().await.map_err(|_| ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "ParaTranz 请求队列已关闭"))?;
    let mut request = state.client.get(format!("{}/projects/{project}/artifacts/download", state.base_url));
    if !credentials.token.is_empty() {
        let token = credentials.token.trim();
        let auth = if token.to_ascii_lowercase().starts_with("bearer ") { token.to_owned() } else { format!("Bearer {token}") };
        request = request.header("Authorization", HeaderValue::from_str(&auth).map_err(|_| ApiError::invalid("Token 格式无效"))?);
    } else if !credentials.cookie.is_empty() {
        request = request.header("Cookie", HeaderValue::from_str(&credentials.cookie).map_err(|_| ApiError::invalid("登录会话无效"))?);
    } else {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "请先登录 ParaTranz 或连接 API Token"));
    }
    let response = request.send().await.map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "无法连接 ParaTranz，请检查网络或系统代理"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let data: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        let message = data.get("message").and_then(Value::as_str).unwrap_or("ParaTranz 导出下载失败");
        return Err(ApiError::new(status, message));
    }
    const MAX_DOWNLOAD_BYTES: u64 = 536_870_912;
    if response.content_length().is_some_and(|length| length > MAX_DOWNLOAD_BYTES) {
        return Err(ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, "导出文件超过本机保存上限（512 MiB）"));
    }
    let directory = std::env::temp_dir().join("ScTranslateKit");
    tokio::fs::create_dir_all(&directory).await.map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "无法创建本机临时下载目录"))?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let path = directory.join(format!("project-{project}-{timestamp}.zip"));
    let mut file = tokio::fs::File::create(&path).await.map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "无法创建本机临时导出文件"))?;
    let mut stream = response;
    let mut written = 0u64;
    let mut prefix = Vec::with_capacity(4);
    let result: Result<(), ApiError> = async {
        while let Some(chunk) = stream.chunk().await.map_err(|_| ApiError::new(StatusCode::BAD_GATEWAY, "导出文件下载中断"))? {
            if prefix.len() < 4 { prefix.extend_from_slice(&chunk[..chunk.len().min(4 - prefix.len())]); }
            if prefix.len() >= 2 && prefix[..2] != *b"PK" { return Err(ApiError::new(StatusCode::BAD_GATEWAY, "ParaTranz 返回内容不是 ZIP 导出文件")); }
            written = written.saturating_add(chunk.len() as u64);
            if written > MAX_DOWNLOAD_BYTES { return Err(ApiError::new(StatusCode::PAYLOAD_TOO_LARGE, "导出文件超过本机保存上限（512 MiB）")); }
            file.write_all(&chunk).await.map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "写入本机临时导出文件失败"))?;
        }
        if written < 4 || prefix.len() < 2 { return Err(ApiError::new(StatusCode::BAD_GATEWAY, "ParaTranz 返回了空的导出文件")); }
        file.flush().await.map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "写入本机临时导出文件失败"))?;
        Ok(())
    }.await;
    if let Err(error) = result {
        drop(file);
        let _ = tokio::fs::remove_file(&path).await;
        return Err(error);
    }
    Ok(json!({"path":path.to_string_lossy(),"filename":format!("paratranz-project-{project}.zip")}))
}

async fn health() -> Json<Value> {
    Json(json!({"status":"ready", "version":env!("CARGO_PKG_VERSION")}))
}

async fn connect(
    State(state): State<Arc<AppState>>,
    Json(credentials): Json<Credentials>,
) -> AppResult {
    let started_epoch = state.connection_epoch.load(Ordering::SeqCst);
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
    let mut current_credentials = state.credentials.write().await;
    if state.connection_epoch.load(Ordering::SeqCst) != started_epoch {
        return Err(ApiError::new(StatusCode::CONFLICT, "连接已变更，此次登录结果已失效"));
    }
    *state.active_account_id.write().await = user.get("id").and_then(Value::as_u64);
    *current_credentials = Some(credentials);
    let epoch = state.connection_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    drop(current_credentials);
    state.suggestions.lock().await.clear();
    Ok(Json(json!({"authenticated":true,"mode":mode,"user":user,"connectionEpoch":epoch})))
}

async fn disconnect(State(state): State<Arc<AppState>>) -> AppResult {
    state.connection_epoch.fetch_add(1, Ordering::SeqCst);
    let mut credentials = state.credentials.write().await;
    *credentials = None;
    *state.active_account_id.write().await = None;
    drop(credentials);
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
        let guard = state.credentials.read().await;
        let credentials = guard.clone();
        let epoch = state.connection_epoch.load(Ordering::SeqCst);
        drop(guard);
        if let Some(credentials) = credentials {
            let account = remote(&state, &credentials, Method::GET, "/account", &[], None).await?;
            let user = account.get("user").unwrap_or(&account);
            id(user, "id")?;
            check_connection_epoch(&state, epoch)?;
            return Ok(Json(json!({"authenticated":true,"mode":if credentials.token.is_empty(){"session"}else{"token"},"user":user,"connectionEpoch":epoch})));
        }
        return Ok(Json(json!({"authenticated":false,"mode":"none"})));
    }
    if action == "drafts" {
        let account = id(&payload, "accountId")?;
        if *state.active_account_id.read().await != Some(account) { return Err(ApiError::new(StatusCode::FORBIDDEN, "草稿账号与当前登录账号不一致")); }
        let prefix = format!("{account}/");
        let drafts = state.drafts.lock().await;
        if let Some(ids) = payload.get("stringIds") {
            let project = id(&payload, "projectId")?;
            let ids = ids.as_array().filter(|ids| !ids.is_empty() && ids.len() <= 25)
                .ok_or_else(|| ApiError::invalid("草稿批量读取需包含 1 到 25 个词条"))?;
            let mut visible = DraftMap::new();
            for value in ids {
                let string = id(&json!({"stringId": value}), "stringId")?;
                let key = format!("{project}/{string}");
                if let Some(draft) = drafts.get(&format!("{account}/{key}")) { visible.insert(key, draft.clone()); }
            }
            return Ok(Json(json!(visible)));
        }
        let visible: DraftMap = drafts.iter().filter_map(|(key, value)|
            key.strip_prefix(&prefix).and_then(|rest| (rest.matches('/').count() == 1).then(|| (rest.to_owned(), value.clone())))
        ).collect();
        return Ok(Json(json!(visible)));
    }
    if action == "legacyDrafts" {
        let account = id(&payload, "accountId")?;
        if *state.active_account_id.read().await != Some(account) { return Err(ApiError::new(StatusCode::FORBIDDEN, "草稿账号与当前登录账号不一致")); }
        let project = id(&payload, "projectId")?;
        let prefix = format!("{project}/");
        let drafts = state.drafts.lock().await;
        let count = drafts.keys().filter(|key| key.starts_with(&prefix) && key.matches('/').count() == 1 && !drafts.contains_key(&format!("{account}/{key}"))).count();
        return Ok(Json(json!({"count":count})));
    }
    if action == "claimLegacyDrafts" {
        let account = id(&payload, "accountId")?;
        if *state.active_account_id.read().await != Some(account) { return Err(ApiError::new(StatusCode::FORBIDDEN, "草稿账号与当前登录账号不一致")); }
        let project = id(&payload, "projectId")?;
        let prefix = format!("{project}/");
        let mut drafts = state.drafts.lock().await;
        let mut next = drafts.clone();
        let mut imported = 0;
        for (key, value) in drafts.iter().filter(|(key, _)| key.starts_with(&prefix) && key.matches('/').count() == 1) {
            let scoped = format!("{account}/{key}");
            if !next.contains_key(&scoped) { next.insert(scoped, value.clone()); imported += 1; }
        }
        write_drafts(&state, &next).await?;
        *drafts = next;
        return Ok(Json(json!({"imported":imported})));
    }
    let project = if action == "projects" { 0 } else { id(&payload, "projectId")? };
    if action == "draftBatch" {
        return draft_batch(&state, project, &payload).await;
    }
    if action == "draft" {
        let string = id(&payload, "stringId")?;
        let account = id(&payload, "accountId")?;
        if *state.active_account_id.read().await != Some(account) { return Err(ApiError::new(StatusCode::FORBIDDEN, "草稿账号与当前登录账号不一致")); }
        let key = format!("{account}/{project}/{string}");
        let mut drafts = state.drafts.lock().await;
        check_expected_epoch(&state, &payload)?;
        check_draft_version(&drafts, &key, &payload)?;
        let mut next = drafts.clone();
        if payload.get("remove").and_then(Value::as_bool) == Some(true) {
            next.remove(&key);
        } else {
            next.insert(key, json!({"translation":translation(&payload)?,"stage":stage(&payload)?,"updatedAt":payload.get("updatedAt")}));
        }
        begin_mcp_commit(&state, &payload).await?;
        write_drafts(&state, &next).await?;
        *drafts = next;
        return Ok(Json(json!({"saved":true})));
    }
    let guard = state.credentials.read().await;
    let credentials = guard.clone().ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "请先连接 ParaTranz"))?;
    let epoch = state.connection_epoch.load(Ordering::SeqCst);
    drop(guard);
    if action == "saveBatch" {
        return save_batch(state, credentials, epoch, project, payload).await;
    }
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
        "fileLabels" => {
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("{project_path}/files/labels"),
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
            let filters = string_filter_params(&payload)?;
            let advanced_stages = filters.iter().any(|(key, _)| key == "stage");
            if payload.get("fileId").and_then(Value::as_u64).unwrap_or(0) > 0 && payload.get("searchInCurrentFile").and_then(Value::as_bool) != Some(false) {
                query.push(("file".into(), id(&payload, "fileId")?.to_string()));
            }
            if !advanced_stages && payload.get("stage").is_some_and(|s| !s.is_null()) {
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
            query.extend(filters);
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
        "userSearch" => {
            let term = payload.get("query").and_then(Value::as_str).unwrap_or("").trim();
            if term.len() < 1 || term.len() > 100 {
                return Err(ApiError::invalid("请输入 1 到 100 个字符的用户名或昵称"));
            }
            remote(
                &state,
                &credentials,
                Method::GET,
                &format!("/users/refer/{}", encode_path_segment(term)),
                &[("all".into(), "1".into())],
                None,
            ).await?
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
        "projectSection" => {
            let section = payload.get("section").and_then(Value::as_str).unwrap_or("");
            let page = payload.get("page").and_then(Value::as_u64).unwrap_or(1).clamp(1, 100000);
            let page_size = payload.get("pageSize").and_then(Value::as_u64).unwrap_or(50).clamp(1, 200);
            let mut section_query = Vec::new();
            let path = match section {
                "files" => format!("{project_path}/files"),
                "history" => {
                    section_query.extend([("page".into(), page.to_string()), ("pageSize".into(), page_size.to_string())]);
                    if let Some(value) = payload.get("type").and_then(Value::as_str).filter(|value| ["translate", "edit", "check", "review", "comment", "term", "import"].contains(value)) {
                        section_query.push(("type".into(), value.to_owned()));
                    }
                    for field in ["begin", "end"] {
                        if let Some(value) = payload.get(field).and_then(Value::as_str).filter(|value| value.len() <= 64 && !value.trim().is_empty()) {
                            section_query.push((field.into(), value.to_owned()));
                        }
                    }
                    if let Some(value) = payload.get("keyword").and_then(Value::as_str).filter(|value| value.len() <= 500 && !value.trim().is_empty()) {
                        section_query.push(("keyword".into(), value.trim().to_owned()));
                    }
                    format!("{project_path}/history")
                }
                "announcements" => {
                    section_query.extend([("page".into(), page.to_string()), ("pageSize".into(), page_size.to_string())]);
                    if let Some(category) = payload.get("category").and_then(Value::as_str).filter(|value| !value.trim().is_empty()) {
                        section_query.push(("category".into(), category.trim().to_owned()));
                    }
                    if payload.get("bumped").and_then(Value::as_bool) == Some(true) {
                        section_query.push(("bumped".into(), "true".into()));
                    }
                    format!("{project_path}/announcements")
                }
                "tasks" => {
                    section_query.extend([("page".into(), page.to_string()), ("pageSize".into(), page_size.to_string())]);
                    format!("{project_path}/tasks")
                }
                "terms" => {
                    section_query.extend([("page".into(), page.to_string()), ("pageSize".into(), page_size.to_string())]);
                    format!("{project_path}/terms")
                }
                "issues" => {
                    if let Some(status) = payload.get("status").and_then(Value::as_i64).filter(|value| [0, 1].contains(value)) {
                        section_query.push(("status".into(), status.to_string()));
                    }
                    format!("{project_path}/issues")
                }
                "members" => format!("{project_path}/members"),
                "applications" => {
                    section_query.extend([("page".into(), page.to_string()), ("pageSize".into(), page_size.to_string())]);
                    if let Some(status) = payload.get("status").and_then(Value::as_i64).filter(|value| (0..=2).contains(value)) {
                        section_query.push(("status".into(), status.to_string()));
                    }
                    format!("{project_path}/applications")
                }
                "leaderboard" => {
                    format!("{project_path}/members")
                }
                "artifact" => {
                    section_query.extend([("page".into(), page.to_string()), ("pageSize".into(), page_size.to_string())]);
                    format!("{project_path}/artifacts")
                }
                _ => return Err(ApiError::invalid("无效的项目栏目")),
            };
            remote(&state, &credentials, Method::GET, &path, &section_query, None).await?
        }
        "projectSectionDetail" => {
            let section = payload.get("section").and_then(Value::as_str).unwrap_or("");
            let resource_id = id(&payload, "resourceId")?;
            let path = match section {
                "announcements" => format!("{project_path}/announcements/{resource_id}"),
                "tasks" => format!("{project_path}/tasks/{resource_id}"),
                "issues" => format!("{project_path}/issues/{resource_id}"),
                "applications" => format!("{project_path}/applications/{resource_id}"),
                "terms" => format!("{project_path}/terms/{resource_id}"),
                _ => return Err(ApiError::invalid("此项目栏目不支持详情读取")),
            };
            remote(&state, &credentials, Method::GET, &path, &[], None).await?
        }
        "downloadArtifact" => download_artifact(&state, &credentials, project).await?,
        "projectSectionAction" => {
            let section = payload.get("section").and_then(Value::as_str).unwrap_or("");
            let operation = payload.get("operation").and_then(Value::as_str).unwrap_or("");
            let data = payload.get("data").filter(|value| value.is_object()).cloned().unwrap_or_else(|| json!({}));
            let resource_id = payload.get("resourceId").and_then(Value::as_u64).filter(|value| *value > 0);
            let mut query = Vec::new();
            let (method, path, body) = match (section, operation) {
                ("announcements", "create") => {
                    let title = data.get("title").and_then(Value::as_str).unwrap_or("").trim();
                    let content = data.get("content").and_then(Value::as_str).unwrap_or("");
                    if title.is_empty() || title.len() > 500 || content.trim().is_empty() || content.len() > 100_000 { return Err(ApiError::invalid("公告标题或内容无效")); }
                    let category = data.get("category").and_then(Value::as_str).unwrap_or("announcement").trim();
                    if category.len() > 80 { return Err(ApiError::invalid("公告分类过长")); }
                    (Method::POST, format!("{project_path}/announcements"), Some(json!({"title":title,"content":content,"category":category,"bumped":data.get("bumped").and_then(Value::as_bool).unwrap_or(false),"internal":data.get("internal").and_then(Value::as_bool).unwrap_or(false)})))
                }
                ("announcements", "update") => {
                    let id = resource_id.ok_or_else(|| ApiError::invalid("缺少公告 ID"))?;
                    let mut body = serde_json::Map::new();
                    if let Some(value) = data.get("title") { let text = value.as_str().unwrap_or("").trim(); if text.is_empty() || text.len() > 500 { return Err(ApiError::invalid("公告标题无效")); } body.insert("title".into(), json!(text)); }
                    if let Some(value) = data.get("content") { let text = value.as_str().unwrap_or(""); if text.trim().is_empty() || text.len() > 100_000 { return Err(ApiError::invalid("公告内容无效")); } body.insert("content".into(), json!(text)); }
                    if let Some(value) = data.get("category") { let text = value.as_str().unwrap_or("announcement").trim(); if text.is_empty() || text.len() > 80 { return Err(ApiError::invalid("公告分类无效")); } body.insert("category".into(), json!(text)); }
                    for field in ["bumped", "internal"] { if let Some(value) = data.get(field).and_then(Value::as_bool) { body.insert(field.into(), json!(value)); } }
                    (Method::PUT, format!("{project_path}/announcements/{id}"), Some(Value::Object(body)))
                }
                ("announcements", "delete") => (Method::DELETE, format!("{project_path}/announcements/{}", resource_id.ok_or_else(|| ApiError::invalid("缺少公告 ID"))?), None),
                ("tasks", "create") | ("tasks", "update") => {
                    let creating = operation == "create";
                    let id = if creating { None } else { Some(resource_id.ok_or_else(|| ApiError::invalid("缺少任务 ID"))?) };
                    let title = data.get("title").and_then(Value::as_str).unwrap_or("").trim();
                    if (creating || data.get("title").is_some()) && (title.is_empty() || title.len() > 128) { return Err(ApiError::invalid("任务标题须为 1 到 128 个字符")); }
                    let mut body = serde_json::Map::new();
                    if creating || data.get("title").is_some() { body.insert("title".into(), json!(title)); }
                    if let Some(value) = data.get("content") { let content = value.as_str().unwrap_or(""); if content.len() > 100_000 { return Err(ApiError::invalid("任务说明过长")); } body.insert("content".into(), json!(content)); }
                    if let Some(value) = data.get("deadline") { if !value.is_null() && (value.as_str().unwrap_or("").len() > 64 || value.as_str().unwrap_or("").is_empty()) { return Err(ApiError::invalid("任务截止时间无效")); } body.insert("deadline".into(), value.clone()); }
                    if creating || data.get("goal").is_some() {
                        let goal = data.get("goal").filter(|value| value.is_object()).cloned().ok_or_else(|| ApiError::invalid("请选择至少一个任务目标"))?;
                        for field in ["translate", "check", "review"] { if let Some(value) = goal.get(field) { let number = value.as_f64().ok_or_else(|| ApiError::invalid("任务目标须为 0 到 1 的数字"))?; if !(0.0..=1.0).contains(&number) { return Err(ApiError::invalid("任务目标须为 0 到 1 的数字")); } } }
                        body.insert("goal".into(), goal);
                    }
                    if let Some(value) = data.get("bumped").and_then(Value::as_bool) { body.insert("bumped".into(), json!(value)); }
                    let path = id.map(|id| format!("{project_path}/tasks/{id}")).unwrap_or_else(|| format!("{project_path}/tasks"));
                    (if creating { Method::POST } else { Method::PUT }, path, Some(Value::Object(body)))
                }
                ("tasks", "delete") => (Method::DELETE, format!("{project_path}/tasks/{}", resource_id.ok_or_else(|| ApiError::invalid("缺少任务 ID"))?), None),
                ("tasks", "pin") | ("tasks", "unpin") | ("tasks", "finish") => {
                    let id = resource_id.ok_or_else(|| ApiError::invalid("缺少任务 ID"))?;
                    (Method::POST, format!("{project_path}/tasks/{id}"), Some(json!({"op":operation})))
                }
                ("tasks", "addFile") => {
                    let task_id = resource_id.ok_or_else(|| ApiError::invalid("缺少任务 ID"))?;
                    let file_id = id(&data, "fileId")?;
                    let mode = data.get("mode").and_then(Value::as_i64).filter(|value| [0,1].contains(value)).unwrap_or(0);
                    (Method::POST, format!("{project_path}/tasks/{task_id}/files"), Some(json!({"fileId":file_id,"mode":mode})))
                }
                ("tasks", "removeFile") => {
                    let task_id = resource_id.ok_or_else(|| ApiError::invalid("缺少任务 ID"))?;
                    let file_id = id(&data, "fileId")?;
                    query.push(("file".into(), file_id.to_string()));
                    (Method::DELETE, format!("{project_path}/tasks/{task_id}/files"), None)
                }
                ("issues", "create") => {
                    let title = data.get("title").and_then(Value::as_str).unwrap_or("").trim();
                    let content = data.get("content").and_then(Value::as_str).unwrap_or("");
                    if title.is_empty() || title.len() > 500 || content.trim().is_empty() || content.len() > 100_000 { return Err(ApiError::invalid("讨论标题或内容无效")); }
                    (Method::POST, format!("{project_path}/issues"), Some(json!({"title":title,"content":content})))
                }
                ("issues", "reply") | ("issues", "subscribe") | ("issues", "unsubscribe") => {
                    let id = resource_id.ok_or_else(|| ApiError::invalid("缺少讨论 ID"))?;
                    let content = data.get("content").and_then(Value::as_str).unwrap_or("");
                    if operation == "reply" && (content.trim().is_empty() || content.len() > 100_000) { return Err(ApiError::invalid("回复内容无效")); }
                    let body = if operation == "reply" { json!({"op":"reply","content":content}) } else { json!({"op":operation}) };
                    (Method::POST, format!("{project_path}/issues/{id}"), Some(body))
                }
                ("issues", "update") => {
                    let id = resource_id.ok_or_else(|| ApiError::invalid("缺少讨论 ID"))?;
                    let mut body = serde_json::Map::new();
                    if let Some(value) = data.get("title") { let title = value.as_str().unwrap_or("").trim(); if title.is_empty() || title.len() > 500 { return Err(ApiError::invalid("讨论标题无效")); } body.insert("title".into(), json!(title)); }
                    if let Some(value) = data.get("content") { let content = value.as_str().unwrap_or(""); if content.trim().is_empty() || content.len() > 100_000 { return Err(ApiError::invalid("讨论内容无效")); } body.insert("content".into(), json!(content)); }
                    if let Some(status) = data.get("status").and_then(Value::as_i64).filter(|value| [0,1].contains(value)) { body.insert("status".into(), json!(status)); }
                    (Method::PUT, format!("{project_path}/issues/{id}"), Some(Value::Object(body)))
                }
                ("issues", "delete") => (Method::DELETE, format!("{project_path}/issues/{}", resource_id.ok_or_else(|| ApiError::invalid("缺少讨论 ID"))?), None),
                ("members", "add") => {
                    let uid = id(&data, "uid")?;
                    let permission = data.get("permission").and_then(Value::as_i64).filter(|value| [1,2,3,10].contains(value)).ok_or_else(|| ApiError::invalid("成员权限无效"))?;
                    (Method::POST, format!("{project_path}/members"), Some(json!({"uid":uid,"permission":permission})))
                }
                ("members", "update") => {
                    let id = resource_id.ok_or_else(|| ApiError::invalid("缺少成员 ID"))?;
                    let mut body = serde_json::Map::new();
                    if let Some(permission) = data.get("permission").and_then(Value::as_i64) { if ![1,2,3,10].contains(&permission) { return Err(ApiError::invalid("成员权限无效")); } body.insert("permission".into(), json!(permission)); }
                    if let Some(note) = data.get("note").and_then(Value::as_str) { if note.len() > 5000 { return Err(ApiError::invalid("成员备注过长")); } body.insert("note".into(), json!(note)); }
                    (Method::PUT, format!("{project_path}/members/{id}"), Some(Value::Object(body)))
                }
                ("members", "delete") => (Method::DELETE, format!("{project_path}/members/{}", resource_id.ok_or_else(|| ApiError::invalid("缺少成员 ID"))?), None),
                ("applications", "approve") | ("applications", "reject") => {
                    let id = resource_id.ok_or_else(|| ApiError::invalid("缺少申请 ID"))?;
                    let status = if operation == "approve" { 2 } else { 1 };
                    let reason = data.get("reason").and_then(Value::as_str).unwrap_or("");
                    if reason.len() > 5000 || (operation == "reject" && reason.trim().is_empty()) { return Err(ApiError::invalid("请填写有效的申请理由")); }
                    (Method::PUT, format!("{project_path}/applications/{id}"), Some(json!({"status":status,"reason":reason})))
                }
                ("applications", "withdraw") => (Method::DELETE, format!("{project_path}/applications/{}", resource_id.ok_or_else(|| ApiError::invalid("缺少申请 ID"))?), None),
                ("artifact", "generate") => (Method::POST, format!("{project_path}/artifacts"), None),
                _ => return Err(ApiError::invalid("无效的项目栏目操作")),
            };
            remote(&state, &credentials, method, &path, &query, body).await?
        }
        "save" => {
            let _save = state.save_gate.lock().await;
            check_save_account(&state, epoch, &payload).await?;
            let string = id(&payload, "stringId")?;
            let target = format!("{project_path}/strings/{string}");
            let current = remote(&state, &credentials, Method::GET, &target, &[], None).await?;
            if current.get("id").and_then(Value::as_u64) != Some(string) { return Err(ApiError::new(StatusCode::BAD_GATEWAY, "ParaTranz 返回了不匹配的词条，未提交")); }
            let mut overwrote_conflict = false;
            for (expected, field) in [
                ("expectedUpdatedAt", "updatedAt"),
                ("expectedTranslation", "translation"),
                ("expectedStage", "stage"),
                ("expectedOriginal", "original"),
            ] {
                let provided = payload
                    .get(expected)
                    .ok_or_else(|| ApiError::invalid("缺少远端版本信息，请重新载入词条"))?;
                overwrote_conflict |= provided != current.get(field).unwrap_or(&Value::Null);
            }
            if payload.get("rejectConflict").and_then(Value::as_bool) == Some(true) && overwrote_conflict {
                return Err(ApiError::new(StatusCode::CONFLICT, "ParaTranz 词条已被修改，请重新读取并确认后再提交"));
            }
            let body = json!({"translation":translation(&payload)?,"stage":stage(&payload)?});
            check_save_account(&state, epoch, &payload).await?;
            if payload.get("expectedDraftUpdatedAt").is_some() {
                let account = id(&payload, "expectedUserId")?;
                let drafts = state.drafts.lock().await;
                check_draft_version(&drafts, &format!("{account}/{project}/{string}"), &payload)?;
            }
            begin_mcp_commit(&state, &payload).await?;
            check_connection_epoch(&state, epoch)?;
            let saved = remote(&state, &credentials, Method::PUT, &target, &[], Some(body)).await?;
            state.suggestions.lock().await.clear();
            let mut saved = if saved.is_null() {
                remote(&state, &credentials, Method::GET, &target, &[], None).await?
            } else {
                saved
            };
            if saved.get("id").and_then(Value::as_u64) != Some(string) { return Err(ApiError::new(StatusCode::BAD_GATEWAY, "提交后词条 ID 无法确认，请重新读取，不要直接重试")); }
            if let Some(item) = saved.as_object_mut() {
                item.insert("overwroteConflict".into(), Value::Bool(overwrote_conflict));
            }
            saved
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
        .route("/internal/mcp-operation", post(mcp_operation))
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
        .user_agent(format!("Pulsar/{}", env!("CARGO_PKG_VERSION")));
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
        active_account_id: RwLock::new(None),
        connection_epoch: AtomicU64::new(std::env::var("SCKIT_CONNECTION_EPOCH").ok().and_then(|value| value.parse::<u64>().ok()).filter(|value| *value < (1u64 << 48)).ok_or("SCKIT_CONNECTION_EPOCH is required")?),
        mcp_policy_version: AtomicU64::new(0),
        mcp_operations: Mutex::new(BTreeMap::new()),
        save_gate: Mutex::new(()),
        remote_gate: Semaphore::new(4),
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
