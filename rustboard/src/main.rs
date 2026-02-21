mod config;
mod system;
mod fs_handler;
mod hub;
mod handlers;

use axum::{
    routing::{get, post},
    Router,
    extract::{State, ConnectInfo, DefaultBodyLimit},
};
use std::net::SocketAddr;
use std::path::Path;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use tower_http::trace::TraceLayer;
use tower_http::cors::CorsLayer;
use std::sync::Arc;
use tower_http::services::ServeDir;
use tower_http::catch_panic::CatchPanicLayer;

#[derive(Clone)]
pub struct AppState {
    pub config: config::Config,
    pub hub: Arc<hub::Hub>,
}

#[tokio::main]
async fn main() {
    // Setup logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "rustboard=info,tower_http=info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let exe_path = std::env::current_exe().unwrap_or_default();
    let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));
    let exe_name = exe_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("rustboard");
    let base_name = exe_name.split('.').next().unwrap_or("rustboard");

    let cfg = config::load_config(exe_dir, base_name);
    info!("RustBoard starting...");
    info!("Config loaded: port={}, board_file={}, upload_dir={}", 
        cfg.port, cfg.board_file, cfg.upload_dir);

    // Initialize static assets
    // Initialize static assets
    let static_zip = include_bytes!("../assets/static.zip");
    
    let static_dir: Option<std::path::PathBuf> = [
        exe_dir.join("static"),
        exe_dir.join("../../static"),
        std::path::Path::new("static").to_path_buf(),
    ].into_iter().find(|p| p.exists());

    fs_handler::init_static_assets(Some(static_zip), static_dir.as_deref()).await;

    // Initialize Hub
    let hub = hub::Hub::new(Path::new(&cfg.board_file).to_path_buf());
    hub.clone().run(cfg.no_watch).await;

    let state = AppState {
        config: cfg.clone(),
        hub: hub.clone(),
    };

    let port = cfg.port.parse::<u16>().unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let app = Router::new()
        .route("/config", get(handlers::config_handler))
        .route("/host", get(handlers::system_info_handler))
        .route("/hw", get(handlers::hw_handler))
        .route("/files", get(handlers::files_handler))
        .route("/uploads", get(handlers::files_handler))
        .route("/upload", post(handlers::upload_handler))
        .route("/endpoints", get(handlers::endpoints_handler))
        .route("/ws", get(|ws, State(state): State<AppState>, ConnectInfo(addr): ConnectInfo<SocketAddr>| {
            hub::ws_handler(ws, state.hub, addr)
        }))
        .route("/favicon.ico", get(|| async move {
            (
                [("content-type", "image/png"), ("cache-control", "public, max-age=86400")],
                bytes::Bytes::from_static(include_bytes!("../winres/icon16.png")),
            )
        }))
        .nest_service("/uploads/", ServeDir::new(&cfg.upload_dir))
        .fallback(fs_handler::static_handler)
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(DefaultBodyLimit::disable())
        .layer(TraceLayer::new_for_http())
        .layer(CatchPanicLayer::new());

    info!("Server starting on http://localhost:{}", port);
    for ip in system::get_all_local_ips() {
        info!("Server starting on http://{}:{}", ip, port);
    }

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}
