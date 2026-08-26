# Agent Sandbox Browser

Dockerized Chromium sandbox for AI agent automation. Chrome 150 with CDP, VNC, and noVNC.

## Architecture

PID 1 is a process supervisor. It starts a **plan** of services from env, then
restarts anything that dies *together with its dependents*.

| Mode | Plan |
| ---- | ---- |
| Headed (`HEADLESS=0`) | Xvfb → Chrome → CDP proxy (`9222→9223`), plus x11vnc → noVNC if `ENABLE_NOVNC=1` |
| Headless (`HEADLESS=1`) | Chrome (`--headless=new`) → CDP proxy. No Xvfb, no VNC. |

Dependencies are explicit: Chrome and x11vnc depend on Xvfb; noVNC depends on x11vnc.
The CDP proxy does not depend on the Chrome process; it reconnects per connection.
Humanizing is opt-in. Set `ENABLE_HUMANIZE=1` and mouse jumps follow the
rewards-farmer Bézier+Fitts path, typing gets mimic_typing delays, and headed
mode warps the X pointer so VNC shows a cursor. Off, 9222 is a plain CDP proxy.

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
      ENABLE_HUMANIZE: "1"

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
| `ENABLE_HUMANIZE` | `0` | Set to `1` to humanize mouse and typing on 9222 |
| `HUMANIZE_SPEED` | `1` | Shared speed multiplier. `2` is twice as fast |
| `HUMANIZE_MOUSE_SPEED` | `HUMANIZE_SPEED` | Mouse-only speed override |
| `HUMANIZE_TYPE_SPEED` | `HUMANIZE_SPEED` | Typing-only speed override |

### Headless vs Non-Headless

| | Non-Headless (`HEADLESS=0`) | Headless (`HEADLESS=1`) |
| --- | --- | --- |
| **Display** | Xvfb virtual framebuffer | None |
| **CDP** | ✅ port 9222 | ✅ port 9222 |
| **VNC** | ✅ port 5900 | ❌ disabled |
| **noVNC** | ✅ port 6080 (if `ENABLE_NOVNC=1`) | ❌ disabled |
| **Memory** | ~300MB+ (Xvfb + Chrome GPU) | ~150MB (Chrome only) |
| **Use for** | Visual debugging, interactive sessions | Headless automation, agent use |

**Note**: VNC and noVNC are silently disabled in headless mode regardless of `ENABLE_NOVNC`.

## Persisting Browser Data

Mount a volume to `/home/agent/.chrome` to persist cookies, local storage, history, and cache across restarts:

```bash
docker run -d --shm-size=2gb -p 9222:9222 -v chrome-data:/home/agent/.chrome agent-sandbox-browser:bookworm-slim
```

Or with Docker Compose (see `volumes:` in the example above).
