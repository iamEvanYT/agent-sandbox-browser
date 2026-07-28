# Agent Sandbox Browser

Dockerized Chromium sandbox for AI agent automation. Chrome 150 with CDP, VNC, and noVNC.

## Quick Start

### Build

```bash
./build.sh
```

### Run with Docker Compose (Recommended)

**Important**: Use `shm_size: 2gb` (not `--shm-size`). Without enough shared memory, Chrome will crash or time out on clicks.

```yaml
services:
  browser:
    image: agent-sandbox-browser:bookworm-slim
    shm_size: 2gb
    ports:
      - "9222:9222"
      - "5900:5900"
      - "6080:6080"
    volumes:
      - chrome-data:/home/agent/.chrome
    environment:
      HEADLESS: "0"
      ENABLE_NOVNC: "1"

volumes:
  chrome-data:
```

### Run with Docker

```bash
# Non-headless (with VNC/noVNC)
docker run -d \
  --shm-size=2gb \
  -p 9222:9222 \
  -p 5900:5900 \
  -p 6080:6080 \
  -v chrome-data:/home/agent/.chrome \
  agent-sandbox-browser:bookworm-slim

# Headless (no display, CDP only)
docker run -d \
  --shm-size=2gb \
  -e HEADLESS=1 \
  -e ENABLE_NOVNC=0 \
  -p 9222:9222 \
  agent-sandbox-browser:bookworm-slim
```

## Ports

| Port | Service | Notes |
| ---- | ------- | ----- |
| 9222 | CDP | Chrome DevTools Protocol — main API for browser control |
| 5900 | VNC | Direct VNC (headless mode disables this) |
| 6080 | noVNC | Web VNC client at http://localhost:6080/vnc.html |

## Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `HEADLESS` | `0` | Run headless (`1` to enable) |
| `ENABLE_NOVNC` | `1` | Enable noVNC (`0` to disable) |

## Persisting Browser Data

Mount a volume to `/home/agent/.chrome` to persist cookies, local storage, history, and cache across restarts:

```bash
docker run -d --shm-size=2gb -p 9222:9222 -v chrome-data:/home/agent/.chrome agent-sandbox-browser:bookworm-slim
```

Or with Docker Compose (see `volumes:` in the example above).
