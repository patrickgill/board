# GoBoard

A collaborative, real-time Markdown whiteboard and editor built with Go.

## Features
- **Real-time Collaboration**: Multiple users can edit the same document simultaneously.
- **Markdown Support**: Live preview of Markdown text.
- **Image Integration**: Paste images directly from your clipboard or drag and drop them into the editor.
- **Mobile Friendly**: Upload photos directly from your mobile device.
- **Single Binary**: All frontend assets are embedded into the Go binary.

## How to Run

### Prerequisites
- Go 1.16 or later installed.

### Start the Server
1. Clone or copy the files.
2. Run the following command:
   ```bash
   go run main.go
   ```
3. Open [http://localhost:8080](http://localhost:8080) in your browser.

### Build as a Binary (Windows)
To create a standalone executable with version info and icon:
```bash
go run build.go
```
This generates `build/goboard.exe`.

## Architecture & Development
For detailed information on how the application works, including the build system, WebSocket protocol, and frontend logic, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Usage
- **Edit**: Collaborate in real-time using Markdown.
- **Images**: Paste images (Ctrl+V) or click "Image" to upload.
- **Network**: Local IP is displayed in the header for easy sharing on LAN.
