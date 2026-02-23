# GoBoard
A networked, multi-user live document, with Markdown syntax.  
Inspired by Google(c) Docs, and Obsidian.  

## Features
Multiple-user single document editing  
WYSIWYM interface  
Produces a single, self-contained binary  
Host OS and hardware information  
File uploading with file index  
TOML file configuration  
Cross-platform   

## Building
### Build tools required
Go  
Node.js  
npm  

*optional*  
mise  

### Build procedure
```
cd goboard  
go run build.go  
./build/goboard  
```
or
```
mise run build:goboard && mise run run:goboard
```

## Usage
When you launch the executable, it automatically handles its own environment by looking for a configuration file. The system uses a smart naming convention: it takes the name of your binary (the "basename") and matches it to a .toml file.

Example: Running `goboard` triggers a search for `goboard.toml`.

The same pattern goes for the document `.md` file. If it exists it will be loaded, or if it doesn't it will be created when the editor is used.  

Once the server is live, head to [http://localhost/](http://localhost/:80). While it defaults to port 80, you can easily swap this out for a custom port in your configuration settings.

## Libraries used
```
Javascript
    CodeMirror 6
    CodeMirror 6 extensions

Go
	"github.com/go-chi/chi/v5"
	"github.com/shirou/gopsutil/v4/process"
    "github.com/BurntSushi/toml"
	"github.com/jaypipes/ghw"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/docker"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/sensors"
    go-winres
```

## 📸
![Goboard screenshot](screenshot.jpeg)

