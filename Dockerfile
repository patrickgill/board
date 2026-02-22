# --- Build stage ---
FROM golang:1.26-alpine AS build

RUN apk add --no-cache nodejs npm

WORKDIR /src
COPY goboard/go.mod goboard/go.sum ./
COPY goboard/vendor/ vendor/
COPY goboard/ .

# Install esbuild and bundle the editor (ci ensures platform-native binaries)
RUN cd editor-src && npm ci

# Build the binary
RUN go run build.go

# --- Runtime stage ---
FROM alpine:3.23

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=build /src/build/goboard .
RUN mkdir -p /app/data

EXPOSE 80

WORKDIR /app/data
ENTRYPOINT ["/app/goboard"]
