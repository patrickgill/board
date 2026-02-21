# GoBoard Architecture & Implementation

This document details the internal architecture of GoBoard for future reference and AI assistants. It explains not just *what* components exist, but *why* specific decisions were made.

## 1. Core Architecture

GoBoard is a single-binary, self-contained application.
- **Frontend**: Vanilla JavaScript (ES6+), Monaco Editor (AMD loaded), Vanilla CSS.
- **Backend**: Go (using `chi` router, `gorilla/websocket`).
- **Storage**: Markdown file (`goboard.md`) + atomic writes.
- **Build System**: Custom `build.go` script for versioning and resource embedding.

### Design Philosophy
1. **Self-Contained**: No external dependencies at runtime. Everything (HTML, JS, CSS, fonts, icons) is embedded into the binary using `//go:embed`.
2. **Resilient**: Handles network flakiness, server restarts, and concurrent edits gracefully.
3. **Zero-Config**: Works out of the box with sensible defaults, but configurable via `goboard.toml`.

## 2. Server Logic (`main.go`)

### WebSocket Protocol
The application usages a single WebSocket connection at `/ws`.
- **Message Types**:
  - `init`: Sent on connection. Contains full document content, client ID, and user count.
  - `update`: Document content change. Broadcast to all other clients.
  - `presence`: User count/list update. Sent on connect/disconnect.
- **Keepalive Strategy**:
  - Server pings every 20s.
  - Expects pong within 30s.
  - If pong is missed, connection is closed server-side.
  - This prevents "zombie" connections from inflating the user count.

### Storage Persistence
- **Atomic Writes**: To prevent data corruption, the server writes content to `.md.tmp` first, then renames it to `.md`. This ensures the file is always valid even if the server crashes during a write.
- **Load on Start**: On startup, it reads the existing `.md` file into memory.

### Networking & Presence
- **Local IP Detection**: `GetLocalIP()` scans network interfaces to find a non-loopback IPv4 address to display in the console and UI, making LAN sharing easy.
- **User List**: `userList()` returns raw remote addresses (e.g., `192.168.1.5:48292`) which are displayed in the frontend presence tooltip.

## 3. Frontend Logic (`static/app.js`)

### Initialization Flow
1. **Variables**: Declared at the top to avoid **Temporal Dead Zone** errors (specifically `reconnectTimer`).
2. **Editor**: Monaco Editor is initialized first. 
3. **Network**: `connect()` is called.
4. **Config**: `loadConfig()` fetches version and local IP info.

### WebSocket Handling
- **Duplicate Prevention**: `connect()` checks `socket.readyState` to prevent stacking connections.
- **Exponential Backoff**: Reconnection attempts start at 1s, doubling up to 10s.
- **Buffer**: `pendingContent` stores updates if the editor hasn't loaded yet.
- **Cursor Preservation**: `msg.type === 'update'` logic saves and restores cursor position to prevent jumping during remote edits.

### Monaco Editor
- **Custom Build**: We use a minified version of Monaco with *only* Markdown support to keep binary size small (~4MB).
- **Configuration**: IntelliSense, minimap, and other "coding" features are disabled to provide a distraction-free writing experience.
- **Theme**: Custom `goboard-dark` theme matches the application UI.

## 4. Build System (`build.go`)

The project uses a `//go:embed` friendly build process.
Running `go run build.go` performs:
1. **Versioning**: Generates a version string based on timestamp `0.YYYYMMDD.HHMM`.
2. **Resource Generation (Windows)**:
   - Updates `winres/winres.json` with the version.
   - Runs `go-winres make` to generate `.syso` files (icon, manifest, version info).
3. **Compilation**: Runs `go build` with `-ldflags` to inject the version string into the binary.

### Icon Handling
- Source: `winres/icon.png` (Master code).
- Favicon: Embedded directly from `winres/icon16.png` into the binary and served at `/favicon.png`. No checking/copying files at build time.

## 5. Key Constants & Config

### `default.toml`
Embedded default configuration written to disk on first run if missing.
- `port`: 8080
- `keybindings`: "default" (or "emacs")

### `app.css`
- Uses CSS variables for theming (`--bg-color`, `--text-dim`).
- Implements a status dot (red/green) for connection state.

## 6. Known "Gotchas"
- **Temporal Dead Zone**: Javascript `let` variables *must* be declared before use. Do not move `reconnectTimer` inside functions or below `connect()` calls.
- **Binary Size**: Monaco is heavy. We stripped all languages except Markdown. Do not re-add full language support without considering size impact.
- **Windows Resources**: `go build .` is required (not `go build main.go`) to link `.syso` files.

## 7. Development Scripts

### Re-installing Monaco Editor (Used v0.52.2)
The original installation was performed using `npm pack` to avoid a full `node_modules` structure.
```powershell
# 1. Download tarball
npm pack monaco-editor@0.52.2 --pack-destination static\vendor\monaco

# 2. Extract only the 'min' directory, stripping the 'package' root folder
tar -xzf static\vendor\monaco\monaco-editor-0.52.2.tgz -C static\vendor\monaco --strip-components=1 "package/min"

# 3. Cleanup
Remove-Item static\vendor\monaco\monaco-editor-0.52.2.tgz
```
*Note: This requires Node.js/NPM to be installed on the system.*
