# Agent Sandbox Browser

Dockerized Chromium sandbox for AI agent automation.

## Quick Start

```bash
./build.sh
```

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

## Ports

| Port | Service |
| ---- | ------- |
| 9222 | CDP (Chrome DevTools Protocol) |
| 5900 | VNC |
| 6080 | NoVNC |

## Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `HEADLESS` | `0` | Run headless (`1` to enable) |
| `ENABLE_NOVNC` | `1` | Enable NoVNC (`0` to disable) |
