package main

import (
	"context"
	"crypto/rand"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/fsnotify/fsnotify"
)

func WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		logger.Error("Websocket accept failed", "error", err, "remote_addr", r.RemoteAddr)
		return
	}

	client := &Client{
		hub:  appHub,
		conn: conn,
		send: make(chan Message, 256),
		addr: r.RemoteAddr,
		id:   randomID(),
	}

	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

const (
	writeTimeout   = 10 * time.Second
	pongTimeout    = 60 * time.Second
	pingInterval   = (pongTimeout * 9) / 10
	maxMessageSize = 20 * 1024 * 1024 // 20MB
)

type Message struct {
	Type    string   `json:"type"`
	Content string   `json:"content"`
	Cursor  int      `json:"cursor,omitempty"`
	ID      string   `json:"id,omitempty"`
	Count   int      `json:"count,omitempty"`
	Users   []string `json:"users,omitempty"`
	IDs     []string `json:"ids,omitempty"`
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan Message
	addr string
	id   string
}

// readPump pumps messages from the websocket connection to the hub.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.CloseNow()
	}()
	c.conn.SetReadLimit(maxMessageSize)

	for {
		var msg Message
		err := wsjson.Read(context.Background(), c.conn, &msg)
		if err != nil {
			if websocket.CloseStatus(err) == websocket.StatusNormalClosure || websocket.CloseStatus(err) == websocket.StatusGoingAway {
				// Normal close
			} else {
				logger.Error("Websocket read error", "error", err, "client_id", c.id, "remote_addr", c.addr)
			}
			break
		}
		c.hub.broadcast <- msg
	}
}

// writePump pumps messages from the hub to the websocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		c.conn.CloseNow()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
			if !ok {
				c.conn.Close(websocket.StatusNormalClosure, "")
				cancel()
				return
			}
			err := wsjson.Write(ctx, c.conn, msg)
			cancel()
			if err != nil {
				logger.Error("Websocket write error", "error", err, "client_id", c.id, "remote_addr", c.addr)
				return
			}

		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
			if err := c.conn.Ping(ctx); err != nil {
				logger.Error("Websocket ping error", "error", err, "client_id", c.id, "remote_addr", c.addr)
				cancel()
				return
			}
			cancel()
		}
	}
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan Message
	register   chan *Client
	unregister chan *Client
	content    string
	filePath   string
	noWatch    bool
	mu         sync.Mutex
	dirty      bool
	stop       chan struct{}
}

func newHub(saveFile string, noWatch bool) *Hub {
	content := ""
	if data, err := os.ReadFile(saveFile); err == nil {
		content = string(data)
		logger.Info("Loaded existing board content", "path", saveFile, "bytes", len(data))
	} else {
		logger.Info("No existing board found", "path", saveFile, "starting_fresh", true)
	}

	return &Hub{
		broadcast:  make(chan Message),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		content:    content,
		filePath:   saveFile,
		noWatch:    noWatch,
		stop:       make(chan struct{}),
	}
}

func (h *Hub) run() {
	if !h.noWatch {
		watcher, err := fsnotify.NewWatcher()
		if err != nil {
			logger.Error("Failed to create file watcher", "error", err)
		} else {
			defer watcher.Close()
			dir := filepath.Dir(h.filePath)
			if err := watcher.Add(dir); err != nil {
				logger.Error("Failed to watch directory", "path", dir, "error", err)
			}

			go func() {
				for {
					select {
					case event, ok := <-watcher.Events:
						if !ok {
							return
						}
						if filepath.Base(event.Name) == filepath.Base(h.filePath) {
							if event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create {
								time.Sleep(50 * time.Millisecond)
								h.reloadContent()
							}
						}
					case err, ok := <-watcher.Errors:
						if !ok {
							return
						}
						logger.Error("File watcher error", "error", err)
					}
				}
			}()
		}
	} else {
		logger.Info("File watcher disabled by config")
	}

	saveTicker := time.NewTicker(2 * time.Second)
	defer saveTicker.Stop()

	for {
		select {
		case <-saveTicker.C:
			h.mu.Lock()
			if h.dirty {
				logger.Info("Persisting board state to disk", "path", h.filePath, "chars", len(h.content))
				tmpFile := h.filePath + ".tmp"
				if err := os.WriteFile(tmpFile, []byte(h.content), 0644); err == nil {
					_ = os.Remove(h.filePath)
					if err := os.Rename(tmpFile, h.filePath); err == nil {
						h.dirty = false
					} else {
						logger.Error("Failed to rename storage file", "error", err, "temp_path", tmpFile, "final_path", h.filePath)
					}
				} else {
					logger.Error("Failed to write storage file", "error", err, "path", tmpFile)
				}
			}
			h.mu.Unlock()

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			count := len(h.clients)
			logger.Info("Client connected", "remote_addr", client.addr, "client_id", client.id, "total_users", count)

			users, ids := h.userLists()
			initMsg := Message{
				Type:    "init",
				Content: h.content,
				ID:      client.id,
				Count:   count,
				Users:   users,
				IDs:     ids,
			}
			client.send <- initMsg

			h.broadcastToAll(Message{
				Type:  "presence",
				Count: count,
				Users: users,
				IDs:   ids,
			})
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				logger.Info("Client disconnected", "remote_addr", client.addr, "client_id", client.id)
				delete(h.clients, client)
				close(client.send)
				count := len(h.clients)
				logger.Info("Users remaining", "total_users", count)
				users, ids := h.userLists()
				h.broadcastToAll(Message{
					Type:  "presence",
					Count: count,
					Users: users,
					IDs:   ids,
				})
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.Lock()
			switch message.Type {
			case "update":
				if h.content != message.Content {
					h.content = message.Content
					h.dirty = true
				}
			case "reload":
				if message.Content != h.content {
					h.content = message.Content
					logger.Info("Reloaded content from disk", "chars", len(h.content))
					h.broadcastToAll(Message{
						Type:    "update",
						Content: h.content,
						ID:      "system",
					})
				}
			}

			if message.Type == "update" {
				h.broadcastToAll(message)
			}
			h.mu.Unlock()

		case <-h.stop:
			logger.Info("Hub shutting down...")
			h.mu.Lock()
			if h.dirty {
				logger.Info("Final persist of board state to disk", "path", h.filePath, "chars", len(h.content))
				if err := os.WriteFile(h.filePath, []byte(h.content), 0644); err != nil {
					logger.Error("Failed to write final storage file", "error", err, "path", h.filePath)
				}
			}

			for client := range h.clients {
				client.conn.Close(websocket.StatusNormalClosure, "server shutting down")
				delete(h.clients, client)
			}
			h.mu.Unlock()
			return
		}
	}
}

func (h *Hub) Stop() {
	close(h.stop)
}

func (h *Hub) reloadContent() {
	data, err := os.ReadFile(h.filePath)
	if err != nil {
		logger.Error("Error reloading file", "error", err, "path", h.filePath)
		return
	}
	h.broadcast <- Message{
		Type:    "reload",
		Content: string(data),
	}
}

func (h *Hub) broadcastToAll(msg Message) {
	for client := range h.clients {
		if client.id == msg.ID {
			continue
		}
		select {
		case client.send <- msg:
		default:
			close(client.send)
			delete(h.clients, client)
			logger.Warn("Client send buffer full, disconnected", "client_id", client.id, "remote_addr", client.addr)
		}
	}
}

func (h *Hub) userLists() (addrs []string, ids []string) {
	addrs = make([]string, 0, len(h.clients))
	ids = make([]string, 0, len(h.clients))
	for client := range h.clients {
		addrs = append(addrs, client.addr)
		ids = append(ids, client.id)
	}
	slices.Sort(addrs)
	slices.Sort(ids)
	return addrs, ids
}

// randomID generates a random 16-character hex string unique enough for our purposes
func randomID() string {
	return strings.ToLower(rand.Text())
}
