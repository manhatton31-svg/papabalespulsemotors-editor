use axum::{
    extract::{DefaultBodyLimit, Multipart, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

const UPLOAD_PAGE: &str = include_str!("phone_upload_page.html");
const DEFAULT_PORT: u16 = 9847;
/// Phone videos are often hundreds of MB — axum defaults to 2 MB for multipart.
const MAX_PHONE_UPLOAD_BYTES: usize = 8 * 1024 * 1024 * 1024;

const ALLOWED_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "m4v", "mkv", "webm", "avi", "3gp", "3g2", "mts", "m2ts", "ts", "mpg", "mpeg",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneUploadServerInfo {
    pub url: String,
    pub host: String,
    pub port: u16,
    pub token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhoneUploadReceivedEvent {
    source_path: String,
    original_name: String,
}

#[derive(Clone, Serialize)]
struct UploadOkResponse {
    ok: bool,
    name: String,
}

#[derive(Clone, Serialize)]
struct UploadErrorResponse {
    ok: bool,
    error: String,
}

struct UploadAppState {
    app: AppHandle,
    incoming_dir: PathBuf,
    token: String,
}

pub struct PhoneUploadRuntime {
    pub token: String,
    pub url: String,
    pub host: String,
    pub port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Default for PhoneUploadRuntime {
    fn default() -> Self {
        Self {
            token: String::new(),
            url: String::new(),
            host: String::new(),
            port: DEFAULT_PORT,
            shutdown_tx: None,
            thread: None,
        }
    }
}

impl PhoneUploadRuntime {
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
        self.token.clear();
        self.url.clear();
        self.host.clear();
    }
}

fn new_session_token() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("pb_{millis}")
}

fn local_lan_ip() -> String {
    local_ip_address::local_ip()
        .unwrap_or(IpAddr::from([127, 0, 0, 1]))
        .to_string()
}

fn extension_allowed(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    ALLOWED_EXTENSIONS.contains(&ext.as_str())
}

fn sanitize_upload_name(name: &str) -> String {
    let path = PathBuf::from(name);
    let base = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.mp4");
    let mut out = String::new();
    for c in base.chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
            out.push(c);
        } else if c.is_whitespace() {
            out.push('_');
        }
    }
    if out.is_empty() {
        "upload.mp4".to_string()
    } else {
        out.chars().take(96).collect()
    }
}

async fn index_page() -> Html<&'static str> {
    Html(UPLOAD_PAGE)
}

#[derive(Debug, Deserialize)]
struct UploadQuery {
    #[serde(rename = "t")]
    token: Option<String>,
}

fn token_is_valid(expected: &str, from_query: Option<&str>, from_form: &str) -> bool {
    if !from_form.is_empty() && from_form == expected {
        return true;
    }
    if let Some(query_token) = from_query {
        if !query_token.is_empty() && query_token == expected {
            return true;
        }
    }
    false
}

async fn upload_multipart(
    Query(query): Query<UploadQuery>,
    State(state): State<Arc<UploadAppState>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let query_token = query.token.clone();
    let mut token = query_token.clone().unwrap_or_default();
    let mut original_name = String::new();
    let mut saved_path: Option<PathBuf> = None;

    loop {
        let field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(UploadErrorResponse {
                        ok: false,
                        error: format!("Could not read upload (file may be too large or connection dropped): {e}"),
                    }),
                )
                    .into_response();
            }
        };

        let name = field.name().unwrap_or("").to_string();
        if name == "token" {
            if let Ok(text) = field.text().await {
                token = text.trim().to_string();
            }
            continue;
        }

        if name != "video" {
            continue;
        }

        original_name = field.file_name().unwrap_or("upload.mp4").to_string();
        let safe_name = sanitize_upload_name(&original_name);
        if !extension_allowed(Path::new(&safe_name)) {
            return (
                StatusCode::BAD_REQUEST,
                Json(UploadErrorResponse {
                    ok: false,
                    error: "Unsupported video format".into(),
                }),
            )
                .into_response();
        }

        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let dest = state.incoming_dir.join(format!("{stamp}_{safe_name}"));

        let mut file = match tokio::fs::File::create(&dest).await {
            Ok(f) => f,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(UploadErrorResponse {
                        ok: false,
                        error: format!("Could not save upload: {e}"),
                    }),
                )
                    .into_response();
            }
        };

        let mut field = field;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    if let Err(e) = file.write_all(&chunk).await {
                        let _ = tokio::fs::remove_file(&dest).await;
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(UploadErrorResponse {
                                ok: false,
                                error: format!("Write failed: {e}"),
                            }),
                        )
                            .into_response();
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&dest).await;
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(UploadErrorResponse {
                            ok: false,
                            error: format!("Upload interrupted: {e}"),
                        }),
                    )
                        .into_response();
                }
            }
        }

        if let Err(e) = file.flush().await {
            let _ = tokio::fs::remove_file(&dest).await;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(UploadErrorResponse {
                    ok: false,
                    error: format!("Could not finalize upload: {e}"),
                }),
            )
                .into_response();
        }

        saved_path = Some(dest);
        break;
    }

    if !token_is_valid(&state.token, query_token.as_deref(), &token) {
        if let Some(path) = saved_path {
            let _ = tokio::fs::remove_file(path).await;
        }
        return (
            StatusCode::UNAUTHORIZED,
            Json(UploadErrorResponse {
                ok: false,
                error: "Session expired — scan the QR code again".into(),
            }),
        )
            .into_response();
    }

    let Some(path) = saved_path else {
        return (
            StatusCode::BAD_REQUEST,
            Json(UploadErrorResponse {
                ok: false,
                error: "No video file received".into(),
            }),
        )
            .into_response();
    };

    let path_str = path.to_string_lossy().into_owned();
    let _ = state.app.emit(
        "phone-upload-received",
        PhoneUploadReceivedEvent {
            source_path: path_str.clone(),
            original_name: if original_name.is_empty() {
                "upload.mp4".into()
            } else {
                original_name.clone()
            },
        },
    );

    (
        StatusCode::OK,
        Json(UploadOkResponse {
            ok: true,
            name: original_name,
        }),
    )
        .into_response()
}

pub fn start_phone_upload_server(
    app: &AppHandle,
    runtime: &mut PhoneUploadRuntime,
) -> Result<PhoneUploadServerInfo, String> {
    runtime.stop();

    let token = new_session_token();
    let host = local_lan_ip();
    let port = DEFAULT_PORT;
    let url = format!("http://{host}:{port}/?t={token}");

    let incoming_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("incoming");
    std::fs::create_dir_all(&incoming_dir).map_err(|e| e.to_string())?;

    let app_for_server = app.clone();
    let token_for_state = token.clone();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let thread = std::thread::Builder::new()
        .name("phone-upload-server".into())
        .spawn(move || {
            let rt = match tokio::runtime::Runtime::new() {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("phone upload runtime failed: {e}");
                    return;
                }
            };

            rt.block_on(async move {
                let state = Arc::new(UploadAppState {
                    app: app_for_server,
                    incoming_dir,
                    token: token_for_state,
                });

                let upload_routes = Router::new()
                    .route("/upload", post(upload_multipart))
                    .layer(DefaultBodyLimit::max(MAX_PHONE_UPLOAD_BYTES));

                let router = Router::new()
                    .route("/", get(index_page))
                    .merge(upload_routes)
                    .with_state(state);

                let addr = format!("0.0.0.0:{port}");
                let listener = match tokio::net::TcpListener::bind(&addr).await {
                    Ok(l) => l,
                    Err(e) => {
                        eprintln!("phone upload bind failed on {addr}: {e}");
                        return;
                    }
                };

                if let Err(e) = axum::serve(listener, router)
                    .with_graceful_shutdown(async {
                        let _ = shutdown_rx.await;
                    })
                    .await
                {
                    eprintln!("phone upload server stopped: {e}");
                }
            });
        })
        .map_err(|e| e.to_string())?;

    runtime.token = token.clone();
    runtime.url = url.clone();
    runtime.host = host.clone();
    runtime.port = port;
    runtime.shutdown_tx = Some(shutdown_tx);
    runtime.thread = Some(thread);

    Ok(PhoneUploadServerInfo {
        url,
        host,
        port,
        token,
    })
}

pub fn stop_phone_upload_server(runtime: &mut PhoneUploadRuntime) {
    runtime.stop();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_page_has_mobile_controls() {
        assert!(UPLOAD_PAGE.contains("Upload to editor"));
        assert!(UPLOAD_PAGE.contains("accept=\"video/*"));
    }

    #[test]
    fn sanitize_strips_unsafe_chars() {
        assert_eq!(sanitize_upload_name("../../evil.mp4"), "evil.mp4");
    }
}