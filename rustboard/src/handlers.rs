use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::Serialize;
use tokio::fs;
use std::path::{Path as stdPath};
use crate::system::{get_system_info, get_preferred_outbound_ip};
use uuid::Uuid;
use tracing::{info, error};

// Define a trait or just use the struct if we don't mind the dependency
// But for handlers, we'll just import the struct from main for now.
// Actually, it's better to define the State requirement locally or use the main AppState.
// Since main.rs is in the same crate, we can import it.
// However, the module structure might make it tricky if we have circular imports.
// A common pattern is to have a separate crate or just a state module.

use crate::AppState;

#[derive(Serialize)]
pub struct UploadInfo {
    pub url: String,
    pub filename: String,
    pub original: String,
}

#[derive(Serialize)]
pub struct FileListItem {
    pub name: String,
    pub size: u64,
    pub mod_time: i64,
    pub is_image: bool,
    pub url: String,
}

pub async fn config_handler(State(state): State<AppState>) -> impl IntoResponse {
    info!("Handling /config request");
    Json(serde_json::json!({
        "version": "0.1.0",
        "local_ip": get_preferred_outbound_ip().unwrap_or_default(),
        "port": state.config.port,
        "max_upload_mb": state.config.max_upload_mb,
    }))
}

pub async fn system_info_handler() -> impl IntoResponse {
    info!("Handling /host request");
    Json(get_system_info())
}

pub async fn files_handler(State(state): State<AppState>) -> impl IntoResponse {
    info!("Handling /files request");
    let mut files = Vec::new();
    let upload_dir = stdPath::new(&state.config.upload_dir);
    
    if let Ok(mut entries) = fs::read_dir(upload_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(metadata) = entry.metadata().await {
                if metadata.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let ext = stdPath::new(&name).extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or_default()
                        .to_lowercase();
                    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp");
                    
                    files.push(FileListItem {
                        name: name.clone(),
                        size: metadata.len(),
                        mod_time: metadata.modified().ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0),
                        is_image,
                        url: format!("/uploads/{}", name),
                    });
                }
            }
        }
    }

    files.sort_by(|a, b| b.mod_time.cmp(&a.mod_time));
    Json(files)
}

pub async fn upload_handler(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    info!("Handling /upload request");
    let mut uploaded = Vec::new();
    let upload_dir = stdPath::new(&state.config.upload_dir);
    
    if !upload_dir.exists() {
        if let Err(_) = fs::create_dir_all(upload_dir).await {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create upload directory").into_response();
        }
    }

    loop {
        match multipart.next_field().await {
            Ok(Some(mut field)) => {
                if let Some(file_name) = field.file_name() {
                    let original_name = file_name.to_string();
                    let mut clean_name = original_name.replace(" ", "_").replace("%", "");
                    
                    let mut file_path = upload_dir.join(&clean_name);
                    if file_path.exists() {
                        let stem = stdPath::new(&clean_name).file_stem()
                            .and_then(|s| s.to_str()).unwrap_or("file");
                        let ext = stdPath::new(&clean_name).extension()
                            .and_then(|e| e.to_str()).map(|e| format!(".{}", e)).unwrap_or_default();
                        clean_name = format!("{}_{}{}", stem, Uuid::new_v4().simple(), ext);
                        file_path = upload_dir.join(&clean_name);
                    }

                    info!("Uploading file: {:?} -> {:?}", original_name, file_path);

                    let mut file = match fs::File::create(&file_path).await {
                        Ok(f) => f,
                        Err(e) => {
                            error!("Failed to create file {:?}: {}", file_path, e);
                            continue;
                        }
                    };

                    let mut size = 0;
                    let max_size = state.config.max_upload_mb * 1024 * 1024;
                    let mut failed = false;

                    // Stream the field content
                    while let Ok(Some(chunk)) = field.chunk().await {
                        size += chunk.len();
                        if size > max_size {
                            failed = true;
                            error!("File too large: {} > {}", size, max_size);
                            break;
                        }
                        if let Err(e) = tokio::io::copy(&mut &chunk[..], &mut file).await {
                            error!("Failed to write to file {:?}: {}", file_path, e);
                            failed = true;
                            break;
                        }
                    }

                    if failed {
                        drop(file);
                        let _ = fs::remove_file(&file_path).await;
                        if size > max_size {
                            return (StatusCode::PAYLOAD_TOO_LARGE, "File too large").into_response();
                        }
                        continue;
                    }

                    uploaded.push(UploadInfo {
                        url: format!("/uploads/{}", clean_name),
                        filename: clean_name,
                        original: original_name,
                    });
                }
            }
            Ok(None) => break,
            Err(e) => {
                error!("Multipart error: {}", e);
                return (StatusCode::BAD_REQUEST, format!("Multipart error: {}", e)).into_response();
            }
        }
    }

    Json(uploaded).into_response()
}

pub async fn hw_handler() -> impl IntoResponse {
    info!("Handling /hw request");
    // Return empty or redirected info to stay compatible with UI
    Json(serde_json::json!({
        "cpu": null,
        "memory": null,
        "block": null,
        "topology": null,
        "network": null,
        "pci": null,
        "gpu": null,
        "chassis": null,
        "bios": null,
        "baseboard": null,
        "product": null,
    }))
}

pub async fn endpoints_handler() -> impl IntoResponse {
    info!("Handling /endpoints request");
    Json(vec![
        "GET /config",
        "GET /host",
        "GET /hw",
        "GET /files",
        "GET /uploads",
        "POST /upload",
        "GET /ws",
        "GET /favicon.ico",
        "GET /endpoints",
    ])
}
