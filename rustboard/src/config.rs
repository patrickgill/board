use serde::{Deserialize, Serialize};
use std::path::Path;
use std::fs;
use tracing::{info, warn};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    #[serde(default = "default_port")]
    pub port: String,
    #[serde(default = "default_board_file")]
    pub board_file: String,
    #[serde(default = "default_upload_dir")]
    pub upload_dir: String,
    #[serde(default = "default_max_upload_mb")]
    pub max_upload_mb: usize,
    #[serde(default = "default_no_watch")]
    pub no_watch: bool,
}

fn default_port() -> String { "8080".to_string() }
fn default_board_file() -> String { "rustboard.md".to_string() }
fn default_upload_dir() -> String { "uploads".to_string() }
fn default_max_upload_mb() -> usize { 100 }
fn default_no_watch() -> bool { false }

impl Default for Config {
    fn default() -> Self {
        Self {
            port: "8080".to_string(),
            board_file: "rustboard.md".to_string(),
            upload_dir: "uploads".to_string(),
            max_upload_mb: 100,
            no_watch: true,
        }
    }
}

pub fn load_config(exe_dir: &Path, base_name: &str) -> Config {
    let mut config = Config {
        board_file: format!("{}.md", base_name),
        ..Config::default()
    };

    let config_path = exe_dir.join(format!("{}.toml", base_name));
    
    if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(content) => {
                match toml::from_str::<Config>(&content) {
                    Ok(parsed) => {
                        config = parsed;
                        info!("Loaded config from {:?}", config_path);
                    }
                    Err(e) => {
                        warn!("Failed to parse config at {:?}: {}, using defaults", config_path, e);
                    }
                }
            }
            Err(e) => {
                warn!("Failed to read config file at {:?}: {}, using defaults", config_path, e);
            }
        }
    } else {
        // Create default config file if it doesn't exist
        // In Go it used include_bytes! or similar for default.toml
        let default_toml = include_str!("../default.toml");
        if let Err(e) = fs::write(&config_path, default_toml) {
            warn!("Could not create default config at {:?}: {}", config_path, e);
        } else {
            info!("Created default config file at {:?}", config_path);
        }
    }

    // Handle environment variable
    if let Ok(env_port) = std::env::var("PORT") {
        config.port = env_port;
    }

    // Resolve relative paths
    if !Path::new(&config.board_file).is_absolute() {
        config.board_file = exe_dir.join(&config.board_file).to_string_lossy().to_string();
    }
    if !Path::new(&config.upload_dir).is_absolute() {
        config.upload_dir = exe_dir.join(&config.upload_dir).to_string_lossy().to_string();
    }

    config
}
