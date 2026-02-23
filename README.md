# GoBoard
Collaborative Markdown editor for your network.

## Features
Single binary  
Toml configuration  
Hardware information  
File uploading for your network  
Cross-platform

## Build tools
```go
node
npm
mise (optional)
```

## Build and run
```
cd goboard
go run build.go
./build/goboard
```

## Libraries used
```
Javascript
    CodeMirror 6

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

## Screenshot
![Goboard screenshot](screenshot.jpeg)

