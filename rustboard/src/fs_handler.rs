use axum::{
    body::Body,
    http::{header, Request, Response, StatusCode},
    response::{IntoResponse},
};
use std::collections::HashMap;
use tokio::fs;
use std::io::{Read};
use std::path::{Path, PathBuf};
use tracing::{error, info, warn};
use zip::ZipArchive;
use once_cell::sync::Lazy;
use std::sync::Arc;
use tokio::sync::RwLock;
use flate2::read::GzDecoder;

pub struct ZipFS {
    archive_data: Option<Vec<u8>>,
    index: HashMap<String, usize>, // name -> index in zip
}

static STATIC_ZIP: Lazy<Arc<RwLock<ZipFS>>> = Lazy::new(|| {
    Arc::new(RwLock::new(ZipFS {
        archive_data: None,
        index: HashMap::new(),
    }))
});

static STATIC_DIR: Lazy<Arc<RwLock<PathBuf>>> = Lazy::new(|| {
    Arc::new(RwLock::new(PathBuf::from("static")))
});

pub async fn init_static_assets(zip_bytes: Option<&'static [u8]>, static_dir: Option<&Path>) {
    if let Some(dir) = static_dir {
        let mut s_dir = STATIC_DIR.write().await;
        *s_dir = dir.to_path_buf();
    }

    // 2. Load embedded zip if available
    let mut zip_fs = STATIC_ZIP.write().await;
    
    if let Some(data) = zip_bytes {
        // Use the embedded bytes directly
        match ZipArchive::new(std::io::Cursor::new(data)) {
            Ok(mut archive) => {
                let mut index = HashMap::new();
                for i in 0..archive.len() {
                    if let Ok(file) = archive.by_index(i) {
                        index.insert(file.name().to_string(), i);
                    }
                }
                info!("Loaded {} static assets from embedded zip", index.len());
                zip_fs.archive_data = Some(data.to_vec()); // We clone here to satisfy the struct's owned Vec<u8>
                zip_fs.index = index;
            }
            Err(e) => {
                error!("Failed to parse embedded static zip: {}", e);
            }
        }
    } else {
        warn!("No embedded static archive found, will serve from 'static' directory");
    }
}

pub async fn static_handler(req: Request<Body>) -> impl IntoResponse {
    let mut path = req.uri().path().trim_start_matches('/').to_string();
    if path.is_empty() {
        path = "index.html".to_string();
    }

    let zip_fs = STATIC_ZIP.read().await;
    info!("Static request: {} (zip loaded: {})", path, zip_fs.archive_data.is_some());
    
    if let Some(archive_data) = &zip_fs.archive_data {
        // Try .gz version first
        let gz_path = format!("{}.gz", path);
        if let Some(&idx) = zip_fs.index.get(&gz_path) {
            return serve_from_zip(archive_data, idx, &path, true, &req);
        }
        
        // Try exact match
        if let Some(&idx) = zip_fs.index.get(&path) {
            return serve_from_zip(archive_data, idx, &path, false, &req);
        }
    }

    // Fallback to disk
    let static_base = {
        let s_dir = STATIC_DIR.read().await;
        s_dir.clone()
    };
    let disk_path = static_base.join(&path);
    if disk_path.exists() && disk_path.is_file() {
        match fs::read(&disk_path).await {
            Ok(content) => {
                let mime = mime_guess::from_path(&disk_path).first_or_octet_stream();
                Response::builder()
                    .header(header::CONTENT_TYPE, mime.as_ref())
                    .body(Body::from(content))
                    .map(|r| r.into_response())
                    .unwrap_or_else(|e| {
                        error!("Response builder error: {}", e);
                        StatusCode::INTERNAL_SERVER_ERROR.into_response()
                    })
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    StatusCode::NOT_FOUND.into_response()
                } else {
                    error!("File read error for {:?}: {}", disk_path, e);
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
    } else {
        StatusCode::NOT_FOUND.into_response()
    }
}

fn serve_from_zip(
    archive_data: &[u8],
    index: usize,
    original_path: &str,
    is_gzipped: bool,
    req: &Request<Body>,
) -> Response<Body> {
    let mut archive = match ZipArchive::new(std::io::Cursor::new(archive_data)) {
        Ok(a) => a,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let mut file = match archive.by_index(index) {
        Ok(f) => f,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    let mut content = Vec::new();
    if let Err(_) = file.read_to_end(&mut content) {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }

    let mime = mime_guess::from_path(original_path).first_or_octet_stream();
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::VARY, "Accept-Encoding");

    if is_gzipped {
        let accept_encoding = req.headers()
            .get(header::ACCEPT_ENCODING)
            .and_then(|h| h.to_str().ok())
            .unwrap_or_default();

        if accept_encoding.contains("gzip") {
            builder = builder.header(header::CONTENT_ENCODING, "gzip");
            builder.body(Body::from(content)).unwrap()
        } else {
            // Must decompress
            let mut decoder = GzDecoder::new(&content[..]);
            let mut decompressed = Vec::new();
            if let Err(_) = decoder.read_to_end(&mut decompressed) {
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            builder.body(Body::from(decompressed)).unwrap()
        }
    } else {
        builder.body(Body::from(content)).unwrap()
    }.into_response()
}
