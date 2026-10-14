use super::*;
use axum::{
    body::{Body, to_bytes},
    extract::Query,
    http::Request,
};
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

#[derive(Default)]
struct MockState {
    writes: Mutex<Vec<Value>>,
    queries: Mutex<Vec<BTreeMap<String, String>>>,
    active: AtomicUsize,
    maximum: AtomicUsize,
    calls: AtomicUsize,
    batch_writes: Mutex<Vec<Value>>,
    batch_rejected: Mutex<Vec<u64>>,
    string_overrides: Mutex<BTreeMap<u64, Value>>,
    read_calls: AtomicUsize,
    read_active: AtomicUsize,
    read_maximum: AtomicUsize,
    read_delay_ms: AtomicUsize,
    block_reads: AtomicUsize,
    read_started: tokio::sync::Notify,
    release_read: tokio::sync::Notify,
    block_writes: AtomicUsize,
    write_started: tokio::sync::Notify,
    release_write: tokio::sync::Notify,
}
fn string_item() -> Value {
    json!({"id":1088220072,"original":"Delphi RS-10","translation":"","stage":0,"updatedAt":null,"key":"Item_NameRADR_IASI_S01","context":"","project":8340})
}
async fn mock_read(State(mock): State<Arc<MockState>>, Path(string): Path<u64>) -> Json<Value> {
    mock.read_calls.fetch_add(1, Ordering::SeqCst);
    let active = mock.read_active.fetch_add(1, Ordering::SeqCst) + 1;
    mock.read_maximum.fetch_max(active, Ordering::SeqCst);
    if mock.block_reads.load(Ordering::SeqCst) > 0 { mock.read_started.notify_one(); mock.release_read.notified().await; }
    let delay = mock.read_delay_ms.load(Ordering::SeqCst);
    if delay > 0 { tokio::time::sleep(Duration::from_millis(delay as u64)).await; }
    let item = mock.string_overrides.lock().await.get(&string).cloned().unwrap_or_else(|| {
        let mut item = string_item(); item["id"] = json!(string); item
    });
    mock.read_active.fetch_sub(1, Ordering::SeqCst);
    Json(item)
}
async fn mock_batch_save(State(mock): State<Arc<MockState>>, Json(body): Json<Value>) -> Json<Value> {
    mock.batch_writes.lock().await.push(body.clone());
    let rejected = mock.batch_rejected.lock().await;
    let mut stored = mock.string_overrides.lock().await;
    let mut ids = Vec::new();
    for item in body["items"].as_array().unwrap() {
        let string = item["id"].as_u64().unwrap();
        if rejected.contains(&string) { continue; }
        let mut saved = string_item(); saved["id"] = json!(string);
        saved["translation"] = item["translation"].clone(); saved["stage"] = item["stage"].clone();
        saved["updatedAt"] = json!("saved"); stored.insert(string, saved); ids.push(string);
    }
    Json(json!(ids))
}
async fn mock_save(State(mock): State<Arc<MockState>>, Path(string): Path<u64>, Json(body): Json<Value>) -> Json<Value> {
    mock.writes.lock().await.push(body.clone());
    if mock.block_writes.load(Ordering::SeqCst) > 0 { mock.write_started.notify_one(); mock.release_write.notified().await; }
    let mut result = string_item();
    result["id"] = json!(string);
    result["translation"] = body["translation"].clone();
    result["stage"] = body["stage"].clone();
    Json(result)
}
async fn mock_list(
    State(mock): State<Arc<MockState>>,
    headers: HeaderMap,
    Query(query): Query<BTreeMap<String, String>>,
) -> Response {
    if headers.get("authorization").and_then(|v| v.to_str().ok()) != Some("Bearer test-token")
        && headers.get("cookie").and_then(|v| v.to_str().ok()) != Some("sid=test-session")
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"message":"Unauthorized"})),
        )
            .into_response();
    }
    mock.queries.lock().await.push(query);
    Json(json!({"results":[string_item()],"page":1,"pageSize":50,"rowCount":1,"pageCount":1}))
        .into_response()
}
async fn mock_account(headers: HeaderMap) -> Response {
    if headers.get("authorization").and_then(|value| value.to_str().ok()) != Some("Bearer test-token")
        && headers.get("cookie").and_then(|value| value.to_str().ok()) != Some("sid=test-session") {
        return (StatusCode::UNAUTHORIZED, Json(json!({"message":"Invalid authentication"}))).into_response();
    }
    Json(json!({"user":{"id":1,"username":"test"}})).into_response()
}
async fn mock_suggestion(State(mock): State<Arc<MockState>>) -> Json<Value> {
    mock.calls.fetch_add(1, Ordering::SeqCst);
    let active = mock.active.fetch_add(1, Ordering::SeqCst) + 1;
    mock.maximum.fetch_max(active, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(35)).await;
    mock.active.fetch_sub(1, Ordering::SeqCst);
    Json(json!([]))
}
async fn setup() -> (Arc<AppState>, Arc<MockState>, tokio::task::JoinHandle<()>) {
    let mock = Arc::new(MockState::default());
    let upstream = Router::new()
        .route("/projects/8340", get(|| async { Json(json!({"id":8340})) }))
        .route(
            "/account",
            get(mock_account),
        )
        .route("/projects/8340/strings", get(mock_list).put(mock_batch_save))
        .route("/projects/8340/strings/{id}", get(mock_read).put(mock_save))
        .route(
            "/projects/8340/strings/{id}/suggestions",
            get(mock_suggestion),
        )
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let handle = tokio::spawn(async move {
        axum::serve(listener, upstream).await.unwrap();
    });
    let state = Arc::new(AppState {
        client: Client::new(),
        base_url,
        secret: "a".repeat(64),
        credentials: RwLock::new(Some(Credentials {
            token: "test-token".into(),
            ..Default::default()
        })),
        active_account_id: RwLock::new(Some(1)),
        connection_epoch: AtomicU64::new(0),
        mcp_policy_version: AtomicU64::new(0),
        mcp_operations: Mutex::new(BTreeMap::new()),
        save_gate: Mutex::new(()),
        remote_gate: Semaphore::new(4),
        drafts: Mutex::new(BTreeMap::new()),
        draft_path: std::env::temp_dir().join(format!(
            "sckit-test-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )),
        suggestions: Mutex::new(BTreeMap::new()),
        suggestion_gate: Mutex::new(()),
    });
    (state, mock, handle)
}
async fn request(state: Arc<AppState>, action: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(format!("/rpc/{action}"))
        .header("x-sckit-key", state.secret.clone())
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = router(state).oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 2_000_000).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
#[tokio::test]
async fn rejects_untrusted_local_requests() {
    let (state, _, handle) = setup().await;
    let response = router(state)
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    handle.abort();
}
#[tokio::test]
async fn public_project_does_not_authenticate_invalid_credentials() {
    let (state, _, handle) = setup().await;
    for (credential, expected) in [
        (
            json!({"token":"invalid-token","projectId":8340}),
            StatusCode::UNAUTHORIZED,
        ),
        (
            json!({"token":"test-token","projectId":8340}),
            StatusCode::OK,
        ),
        (
            json!({"cookie":"sid=test-session","projectId":8340}),
            StatusCode::OK,
        ),
    ] {
        let request = Request::builder()
            .method("POST")
            .uri("/credentials")
            .header("x-sckit-key", state.secret.clone())
            .header("content-type", "application/json")
            .body(Body::from(credential.to_string()))
            .unwrap();
        let response = router(state.clone()).oneshot(request).await.unwrap();
        assert_eq!(response.status(), expected);
        if expected == StatusCode::UNAUTHORIZED {
            assert_eq!(
                state.credentials.read().await.as_ref().unwrap().token,
                "test-token"
            );
        }
    }
    assert_eq!(
        state.credentials.read().await.as_ref().unwrap().cookie,
        "sid=test-session"
    );
    handle.abort();
}
#[tokio::test]
async fn list_preserves_file_stage_and_search_protocol() {
    let (state, mock, handle) = setup().await;
    let (status,_)=request(state,"strings",json!({"projectId":8340,"fileId":3485163,"stage":0,"page":2,"pageSize":100,"text":"Delphi","searchMode":"text"})).await;
    assert_eq!(status, StatusCode::OK);
    let queries = mock.queries.lock().await;
    let query = &queries[0];
    assert_eq!(query.get("file"), Some(&"3485163".into()));
    assert_eq!(query.get("stage"), Some(&"0".into()));
    assert_eq!(query.get("text"), Some(&"Delphi".into()));
    assert_eq!(query.get("detailed"), Some(&"1".into()));
    assert_eq!(query.get("page"), Some(&"2".into()));
    handle.abort();
}
#[test]
fn string_filter_operators_match_para_tranz_query_syntax() {
    let payload = json!({
        "filterParams": [
            ["original^=", "prefix"],
            ["translation!@=", "exact"],
            ["createdAt>=", "2026-10-14T00:00:00.000Z"],
            ["updatedAt<=", "2026-10-14T23:59:59.999Z"],
            ["fileLabel", "17"],
            ["orderBy", "-updatedAt"]
        ]
    });
    assert_eq!(
        string_filter_params(&payload).unwrap(),
        vec![
            ("original^".into(), "prefix".into()),
            ("translation!@".into(), "exact".into()),
            ("createdAt>".into(), "2026-10-14T00:00:00.000Z".into()),
            ("updatedAt<".into(), "2026-10-14T23:59:59.999Z".into()),
            ("fileLabel".into(), "17".into()),
            ("orderBy".into(), "-updatedAt".into()),
        ]
    );
}
#[tokio::test]
async fn conflict_overwrites_remote_write_and_valid_save_is_narrow() {
    let (state, mock, handle) = setup().await;
    let mut payload = json!({"projectId":8340,"stringId":1088220072,"translation":"德尔斐 RS-10","stage":1,"expectedUpdatedAt":null,"expectedTranslation":"outdated","expectedStage":0,"expectedOriginal":"Delphi RS-10"});
    let (status, conflicted) = request(state.clone(), "save", payload.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(mock.writes.lock().await.len(), 1);
    assert_eq!(conflicted["overwroteConflict"], true);
    payload["expectedTranslation"] = json!("");
    let (status, saved) = request(state, "save", payload).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["translation"], "德尔斐 RS-10");
    assert_eq!(saved["overwroteConflict"], false);
    let writes = mock.writes.lock().await;
    assert_eq!(writes.len(), 2);
    assert_eq!(writes[0], json!({"translation":"德尔斐 RS-10","stage":1}));
    handle.abort();
}
#[tokio::test]
async fn suggestions_are_serial_and_cache_repeated_requests() {
    let (state, mock, handle) = setup().await;
    let credentials = Credentials {
        token: "test-token".into(),
        ..Default::default()
    };
    let (first, second) = tokio::join!(
        cached_suggestions(&state, &credentials, 8340, 1),
        cached_suggestions(&state, &credentials, 8340, 2)
    );
    assert!(first.is_ok() && second.is_ok());
    assert!(
        cached_suggestions(&state, &credentials, 8340, 1)
            .await
            .is_ok()
    );
    assert_eq!(mock.maximum.load(Ordering::SeqCst), 1);
    assert_eq!(mock.calls.load(Ordering::SeqCst), 2);
    handle.abort();
}
#[tokio::test]
async fn drafts_persist_and_invalid_identifiers_are_rejected() {
    let (state, _, handle) = setup().await;
    let (status, _) = request(state.clone(), "strings", json!({"projectId":"../../etc"})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status,_)=request(state.clone(),"draft",json!({"accountId":1,"projectId":8340,"stringId":1088220072,"translation":"draft","stage":2,"updatedAt":"2026-10-11"})).await;
    assert_eq!(status, StatusCode::OK);
    let disk: Value = serde_json::from_slice(&std::fs::read(&state.draft_path).unwrap()).unwrap();
    assert_eq!(disk["1/8340/1088220072"]["translation"], "draft");
    let (status, own) = request(state.clone(), "drafts", json!({"accountId":1})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(own["8340/1088220072"]["translation"], "draft");
    let (status, _) = request(state.clone(), "drafts", json!({"accountId":2})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = request(state.clone(), "draft", json!({"accountId":2,"projectId":8340,"stringId":1088220072,"translation":"other","stage":2})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    state.drafts.lock().await.insert("8340/22".into(), json!({"translation":"unassigned","stage":1,"updatedAt":"2026-10-10"}));
    let (status, legacy) = request(state.clone(), "legacyDrafts", json!({"accountId":1,"projectId":8340})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(legacy["count"], 1);
    let (status, imported) = request(state.clone(), "claimLegacyDrafts", json!({"accountId":1,"projectId":8340})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(imported["imported"], 1);
    let (status, own) = request(state.clone(), "drafts", json!({"accountId":1})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(own["8340/22"]["translation"], "unassigned");
    assert!(state.drafts.lock().await.contains_key("8340/22"));
    let _ = std::fs::remove_file(&state.draft_path);
    let _ = std::fs::remove_file(state.draft_path.with_extension("bak"));
    handle.abort();
}

fn batch_save_item(string: u64) -> Value {
    json!({"stringId":string,"translation":format!("translation {string}"),"stage":1,
        "expectedUpdatedAt":null,"expectedTranslation":"","expectedStage":0,"expectedOriginal":"Delphi RS-10",
        "expectedDraftUpdatedAt":null,"expectedDraftTranslation":null,"expectedDraftStage":null})
}

#[tokio::test]
async fn batch_save_validates_each_string_with_bounded_reads_and_one_narrow_put() {
    let (state, mock, handle) = setup().await;
    mock.read_delay_ms.store(5, Ordering::SeqCst);
    let items: Vec<Value> = (1..=25).map(batch_save_item).collect();
    let (status, body) = request(state, "saveBatch", json!({"projectId":8340,"expectedUserId":1,"expectedConnectionEpoch":0,"items":items})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"].as_array().unwrap().len(), 25);
    assert!(body["results"].as_array().unwrap().iter().all(|row| row["saved"] == true));
    assert_eq!(mock.read_calls.load(Ordering::SeqCst), 25);
    assert_eq!(mock.read_maximum.load(Ordering::SeqCst), 4);
    let writes = mock.batch_writes.lock().await;
    assert_eq!(writes.len(), 1);
    assert_eq!(writes[0]["op"], "edit");
    for item in writes[0]["items"].as_array().unwrap() {
        assert_eq!(item.as_object().unwrap().keys().cloned().collect::<BTreeSet<_>>(), BTreeSet::from(["id".into(),"translation".into(),"stage".into()]));
    }
    handle.abort();
}

#[tokio::test]
async fn batch_save_excludes_conflicts_and_reports_upstream_partial_acceptance() {
    let (state, mock, handle) = setup().await;
    let mut changed = string_item(); changed["id"] = json!(1); changed["translation"] = json!("new human edit");
    mock.string_overrides.lock().await.insert(1, changed);
    mock.batch_rejected.lock().await.push(2);
    let (status, body) = request(state, "saveBatch", json!({"projectId":8340,"expectedUserId":1,"expectedConnectionEpoch":0,"items":[batch_save_item(1),batch_save_item(2),batch_save_item(3)]})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"][0]["saved"], false);
    assert_eq!(body["results"][0]["status"], 409);
    assert_eq!(body["results"][1]["saved"], false);
    assert_eq!(body["results"][2]["saved"], true);
    let writes = mock.batch_writes.lock().await;
    assert_eq!(writes.len(), 1);
    assert!(!writes[0]["items"].as_array().unwrap().iter().any(|item| item["id"] == 1));
    assert_eq!(mock.string_overrides.lock().await[&1]["translation"], "new human edit");
    handle.abort();
}

#[tokio::test]
async fn batch_save_rejects_wrong_account_duplicate_ids_and_stale_connection_before_reads() {
    let (state, mock, handle) = setup().await;
    for payload in [
        json!({"projectId":8340,"expectedUserId":2,"items":[batch_save_item(1)]}),
        json!({"projectId":8340,"expectedUserId":1,"expectedConnectionEpoch":9,"items":[batch_save_item(1)]}),
        json!({"projectId":8340,"expectedUserId":1,"items":[batch_save_item(1),batch_save_item(1)]}),
    ] {
        assert!(!request(state.clone(), "saveBatch", payload).await.0.is_success());
    }
    assert_eq!(mock.read_calls.load(Ordering::SeqCst), 0);
    assert!(mock.batch_writes.lock().await.is_empty());
    handle.abort();
}

#[tokio::test]
async fn batch_drafts_write_once_and_preserve_same_timestamp_content_conflicts() {
    let (state, _, handle) = setup().await;
    let existing = json!({"accountId":1,"projectId":8340,"stringId":1,"translation":"new human edit","stage":1,"updatedAt":"same"});
    assert_eq!(request(state.clone(), "draft", existing).await.0, StatusCode::OK);
    let before = std::fs::read(&state.draft_path).unwrap();
    let items = json!([
        {"stringId":1,"translation":"stale edit","stage":1,"updatedAt":"later","expectedDraftUpdatedAt":"same","expectedDraftTranslation":"old","expectedDraftStage":1},
        {"stringId":2,"translation":"second","stage":1,"updatedAt":"later","expectedDraftUpdatedAt":null},
        {"stringId":3,"translation":"third","stage":1,"updatedAt":"later","expectedDraftUpdatedAt":null}
    ]);
    let (status, body) = request(state.clone(), "draftBatch", json!({"accountId":1,"projectId":8340,"expectedConnectionEpoch":0,"items":items})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["results"][0]["saved"], false);
    assert_eq!(body["results"][1]["saved"], true);
    assert_eq!(body["results"][2]["saved"], true);
    assert_eq!(std::fs::read(state.draft_path.with_extension("bak")).unwrap(), before);
    let drafts = state.drafts.lock().await;
    assert_eq!(drafts["1/8340/1"]["translation"], "new human edit");
    assert_eq!(drafts["1/8340/2"]["translation"], "second");
    drop(drafts);
    let _ = std::fs::remove_file(&state.draft_path);
    let _ = std::fs::remove_file(state.draft_path.with_extension("bak"));
    handle.abort();
}

#[tokio::test]
async fn scoped_draft_reads_only_return_requested_account_project_strings() {
    let (state, _, handle) = setup().await;
    {
        let mut drafts = state.drafts.lock().await;
        for string in 1..=100 { drafts.insert(format!("1/8340/{string}"), json!({"translation":"draft"})); }
        drafts.insert("2/8340/1".into(), json!({"translation":"other account"}));
    }
    let (status, body) = request(state.clone(), "drafts", json!({"accountId":1,"projectId":8340,"stringIds":[1,3]})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_object().unwrap().len(), 2);
    assert_eq!(body["8340/1"]["translation"], "draft");
    assert_eq!(request(state, "drafts", json!({"accountId":2,"projectId":8340,"stringIds":[1]})).await.0, StatusCode::FORBIDDEN);
    handle.abort();
}

#[tokio::test]
async fn logout_during_remote_read_stops_the_pending_save_before_put() {
    let (state, mock, handle) = setup().await;
    mock.block_reads.store(1, Ordering::SeqCst);
    let mut item = batch_save_item(1);
    item["projectId"] = json!(8340); item["expectedUserId"] = json!(1); item["expectedConnectionEpoch"] = json!(0); item["rejectConflict"] = json!(true);
    let pending = tokio::spawn(request(state.clone(), "save", item));
    mock.read_started.notified().await;
    let _ = disconnect(State(state)).await.unwrap();
    mock.release_read.notify_one();
    assert_eq!(pending.await.unwrap().0, StatusCode::CONFLICT);
    assert!(mock.writes.lock().await.is_empty());
    handle.abort();
}

const OPERATION_ID: &str = "12345678-1234-1234-1234-123456789abc";
async fn operation_control(state: Arc<AppState>, action: &str, policy_version: u64) -> Value {
    mcp_operation(State(state), Json(json!({"action":action,"operationId":OPERATION_ID,"policyVersion":policy_version}))).await.unwrap().0
}
fn operation_payload(mut payload: Value) -> Value {
    payload["mcpOperationId"] = json!(OPERATION_ID); payload["mcpPolicyVersion"] = json!(0); payload
}

#[tokio::test]
async fn cancellation_and_policy_revocation_during_validation_prevent_single_and_batch_puts() {
    for batch in [false, true] {
        for action in ["cancel", "policy"] {
            let (state, mock, handle) = setup().await;
            operation_control(state.clone(), "begin", 0).await;
            mock.block_reads.store(1, Ordering::SeqCst);
            let mut item = batch_save_item(1);
            item["projectId"] = json!(8340); item["expectedUserId"] = json!(1); item["expectedConnectionEpoch"] = json!(0); item["rejectConflict"] = json!(true);
            let payload = if batch { json!({"projectId":8340,"expectedUserId":1,"expectedConnectionEpoch":0,"items":[item]}) } else { item };
            let pending = tokio::spawn(request(state.clone(), if batch {"saveBatch"} else {"save"}, operation_payload(payload)));
            mock.read_started.notified().await;
            operation_control(state.clone(), action, 1).await;
            mock.release_read.notify_one();
            assert_eq!(pending.await.unwrap().0, StatusCode::CONFLICT);
            assert!(mock.writes.lock().await.is_empty()); assert!(mock.batch_writes.lock().await.is_empty());
            handle.abort();
        }
    }
}

#[tokio::test]
async fn cancelled_leases_cannot_persist_single_or_batch_drafts() {
    for batch in [false, true] {
        let (state, _, handle) = setup().await;
        operation_control(state.clone(), "begin", 0).await;
        operation_control(state.clone(), "cancel", 0).await;
        let item = json!({"stringId":1,"translation":"cancelled","stage":1});
        let payload = if batch { json!({"projectId":8340,"accountId":1,"items":[item]}) }
            else { json!({"projectId":8340,"accountId":1,"stringId":1,"translation":"cancelled","stage":1}) };
        assert_eq!(request(state.clone(), if batch {"draftBatch"} else {"draft"}, operation_payload(payload)).await.0, StatusCode::CONFLICT);
        assert!(state.drafts.lock().await.is_empty()); assert!(!state.draft_path.exists());
        handle.abort();
    }
}

#[tokio::test]
async fn cancellation_after_dispatch_reports_already_submitted_and_keeps_the_actual_result() {
    let (state, mock, handle) = setup().await;
    operation_control(state.clone(), "begin", 0).await;
    mock.block_writes.store(1, Ordering::SeqCst);
    let mut item = batch_save_item(1);
    item["projectId"] = json!(8340); item["expectedUserId"] = json!(1); item["expectedConnectionEpoch"] = json!(0); item["rejectConflict"] = json!(true);
    let pending = tokio::spawn(request(state.clone(), "save", operation_payload(item)));
    mock.write_started.notified().await;
    assert_eq!(operation_control(state, "cancel", 0).await["alreadySubmitted"], true);
    mock.release_write.notify_one(); assert_eq!(pending.await.unwrap().0, StatusCode::OK);
    assert_eq!(mock.writes.lock().await.len(), 1); handle.abort();
}

#[tokio::test]
async fn token_api_authentication_checks_identity_even_without_a_selected_project() {
    let (state, _, handle) = setup().await;
    let invalid = connect(State(state.clone()), Json(Credentials {token:"invalid-token".into(),project_id:0,..Default::default()})).await;
    assert_eq!(invalid.unwrap_err().status, StatusCode::UNAUTHORIZED);
    let accepted = connect(State(state.clone()), Json(Credentials {token:"test-token".into(),project_id:0,..Default::default()})).await.unwrap();
    assert_eq!(accepted.0["mode"], "token"); assert_eq!(accepted.0["user"]["id"], 1);
    assert!(state.credentials.read().await.as_ref().unwrap().cookie.is_empty());
    handle.abort();
}

#[tokio::test]
async fn exchanged_cookie_connection_keeps_presence_authentication_available() {
    let (state, _, handle) = setup().await;
    let accepted = connect(State(state.clone()), Json(Credentials {cookie:"sid=test-session".into(),project_id:0,..Default::default()})).await.unwrap();
    assert_eq!(accepted.0["mode"], "session");
    let presence = presence_connection(State(state), Json(json!({}))).await.unwrap();
    assert_eq!(presence.0["userId"], 1); assert_eq!(presence.0["headers"]["Cookie"], "sid=test-session");
    handle.abort();
}

#[tokio::test]
async fn upstream_concurrency_is_bounded_across_independent_requests() {
    let (state, mock, handle) = setup().await;
    mock.read_delay_ms.store(10, Ordering::SeqCst);
    let mut jobs = tokio::task::JoinSet::new();
    for string in 1..=16 {
        jobs.spawn(request(state.clone(), "string", json!({"projectId":8340,"stringId":string})));
    }
    while let Some(result) = jobs.join_next().await { assert_eq!(result.unwrap().0, StatusCode::OK); }
    assert!(mock.read_maximum.load(Ordering::SeqCst) <= 4);
    assert_eq!(mock.read_calls.load(Ordering::SeqCst), 16); handle.abort();
}
