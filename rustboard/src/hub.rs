use axum::{
    extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{error, info};
use uuid::Uuid;
use dashmap::DashMap;
use futures_util::{sink::SinkExt, stream::StreamExt};
use std::fs;
use std::path::PathBuf;
use notify::{Watcher, RecursiveMode, Event, EventKind};
use tokio::time::{self, Duration};
use std::net::SocketAddr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub users: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
}

pub struct ClientInfo {
    pub tx: mpsc::UnboundedSender<Message>,
    pub addr: String,
}

pub struct Hub {
    pub clients: DashMap<String, ClientInfo>,
    pub broadcast_tx: broadcast::Sender<Message>,
    pub content: Arc<RwLock<String>>,
    pub file_path: PathBuf,
    pub dirty: Arc<RwLock<bool>>,
}

impl Hub {
    pub fn new(file_path: PathBuf) -> Arc<Self> {
        let content = if file_path.exists() {
            fs::read_to_string(&file_path).unwrap_or_default()
        } else {
            String::new()
        };

        let (broadcast_tx, _) = broadcast::channel(100);

        Arc::new(Self {
            clients: DashMap::new(),
            broadcast_tx,
            content: Arc::new(RwLock::new(content)),
            file_path,
            dirty: Arc::new(RwLock::new(false)),
        })
    }

    pub async fn run(self: Arc<Self>, no_watch: bool) {
        let hub = self.clone();
        
        // Periodic save
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(2));
            loop {
                interval.tick().await;
                let is_dirty = { *hub.dirty.read().await };
                if is_dirty {
                    let content = hub.content.read().await.clone();
                    let tmp_path = hub.file_path.with_extension("tmp");
                    if let Ok(_) = fs::write(&tmp_path, &content) {
                        if let Ok(_) = fs::rename(&tmp_path, &hub.file_path) {
                            let mut dirty = hub.dirty.write().await;
                            *dirty = false;
                            info!("Saved board state to {:?}", hub.file_path);
                        }
                    }
                }
            }
        });

        // File watcher
        if !no_watch {
            let hub_for_watcher = self.clone();
            let (tx, mut rx) = mpsc::channel(1);
            
            let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
                if let Ok(event) = res {
                    if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                        let _ = tx.blocking_send(());
                    }
                }
            }).expect("Failed to create watcher");

            if let Some(parent) = self.file_path.parent() {
                let _ = watcher.watch(parent, RecursiveMode::NonRecursive);
            }

            tokio::spawn(async move {
                while let Some(_) = rx.recv().await {
                    time::sleep(Duration::from_millis(100)).await;
                    if let Ok(data) = fs::read_to_string(&hub_for_watcher.file_path) {
                        let mut content = hub_for_watcher.content.write().await;
                        if *content != data {
                            *content = data.clone();
                            let msg = Message {
                                msg_type: "update".to_string(),
                                content: data,
                                cursor: None,
                                id: Some("system".to_string()),
                                count: None,
                                users: None,
                                ids: None,
                            };
                            let _ = hub_for_watcher.broadcast_tx.send(msg);
                        }
                    }
                }
                // Keep watcher alive
                drop(watcher);
            });
        }
    }

    pub async fn broadcast_presence(&self) {
        let (users, ids) = self.user_lists();
        let count = self.clients.len();
        let msg = Message {
            msg_type: "presence".to_string(),
            content: String::new(),
            cursor: None,
            id: None,
            count: Some(count),
            users: Some(users),
            ids: Some(ids),
        };
        let _ = self.broadcast_tx.send(msg);
    }

    pub fn user_lists(&self) -> (Vec<String>, Vec<String>) {
        let mut addrs = Vec::new();
        let mut ids = Vec::new();
        for item in self.clients.iter() {
            ids.push(item.key().clone());
            addrs.push(item.value().addr.clone());
        }
        ids.sort();
        addrs.sort();
        (addrs, ids)
    }
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    hub: Arc<Hub>,
    addr: SocketAddr,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, hub, addr))
}

async fn handle_socket(socket: WebSocket, hub: Arc<Hub>, addr: SocketAddr) {
    let (mut sink, mut stream) = socket.split();
    let client_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let addr_str = addr.to_string();

    hub.clients.insert(client_id.clone(), ClientInfo {
        tx,
        addr: addr_str.clone(),
    });

    info!("Client connected: id={}, addr={}", client_id, addr_str);

    // Send init message
    let (users, ids) = hub.user_lists();
    let init_msg = Message {
        msg_type: "init".to_string(),
        content: hub.content.read().await.clone(),
        cursor: None,
        id: Some(client_id.clone()),
        count: Some(hub.clients.len()),
        users: Some(users),
        ids: Some(ids),
    };
    
    let json = serde_json::to_string(&init_msg).unwrap();
    if let Err(e) = sink.send(WsMessage::Text(json.into())).await {
        error!("Error sending init message: {}", e);
        hub.clients.remove(&client_id);
        return;
    }

    hub.broadcast_presence().await;

    let mut broadcast_rx = hub.broadcast_tx.subscribe();

    let hub_for_read = hub.clone();
    let client_id_for_send = client_id.clone();
    let cleanup_id = client_id.clone();

    // Loop for sending messages to client
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    if let Some(msg) = msg {
                        let json = serde_json::to_string(&msg).unwrap();
                        if let Err(_) = sink.send(WsMessage::Text(json.into())).await { break; }
                    } else { break; }
                }
                msg = broadcast_rx.recv() => {
                    if let Ok(msg) = msg {
                        // Don't echo back to sender if ID matches
                        if msg.id.as_ref() == Some(&client_id_for_send) {
                            continue;
                        }
                        let json = serde_json::to_string(&msg).unwrap();
                        if let Err(_) = sink.send(WsMessage::Text(json.into())).await { break; }
                    }
                }
                _ = time::sleep(Duration::from_secs(30)) => {
                    if let Err(_) = sink.send(WsMessage::Ping(bytes::Bytes::new())).await { break; }
                }
            }
        }
    });

    // Loop for reading messages from client
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            if let WsMessage::Text(text) = msg {
                if let Ok(mut msg) = serde_json::from_str::<Message>(&text) {
                    msg.id = Some(client_id.clone());
                    if msg.msg_type == "update" {
                        let mut content = hub_for_read.content.write().await;
                        if *content != msg.content {
                            *content = msg.content.clone();
                            let mut dirty = hub_for_read.dirty.write().await;
                            *dirty = true;
                        }
                    }
                    let _ = hub_for_read.broadcast_tx.send(msg);
                }
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };

    hub.clients.remove(&cleanup_id);
    hub.broadcast_presence().await;
}
