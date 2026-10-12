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
}
fn string_item() -> Value {
    json!({"id":1088220072,"original":"Delphi RS-10","translation":"","stage":0,"updatedAt":null,"key":"Item_NameRADR_IASI_S01","context":"","project":8340})
}
async fn mock_read() -> Json<Value> {
    Json(string_item())
}
async fn mock_save(State(mock): State<Arc<MockState>>, Json(body): Json<Value>) -> Json<Value> {
    mock.writes.lock().await.push(body.clone());
    let mut result = string_item();
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
            get(|| async { Json(json!({"user":{"id":1,"username":"test"}})) }),
        )
        .route("/projects/8340/strings", get(mock_list))
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
#[tokio::test]
async fn conflict_blocks_remote_write_and_valid_save_is_narrow() {
    let (state, mock, handle) = setup().await;
    let mut payload = json!({"projectId":8340,"stringId":1088220072,"translation":"德尔斐 RS-10","stage":1,"expectedUpdatedAt":null,"expectedTranslation":"outdated","expectedStage":0,"expectedOriginal":"Delphi RS-10"});
    let (status, _) = request(state.clone(), "save", payload.clone()).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(mock.writes.lock().await.is_empty());
    payload["expectedTranslation"] = json!("");
    let (status, saved) = request(state, "save", payload).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["translation"], "德尔斐 RS-10");
    let writes = mock.writes.lock().await;
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
