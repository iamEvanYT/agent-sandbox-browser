# ── build ────────────────────────────────────────────────────────────────────
FROM rust:1-slim-bookworm AS builder

WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

# ── runtime ──────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

ARG TARGETARCH

# Pinned Chrome version (amd64) and Chromium version (arm64)
ARG CHROME_VERSION=150.0.7871.186-1
ARG CHROMIUM_VERSION=150.0.7871.181-1~deb12u1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    gnupg \
    novnc \
    socat \
    wget \
    x11-utils \
    x11vnc \
    xvfb \
    websockify \
  && rm -rf /var/lib/apt/lists/*

# Install Chrome/Chromium based on architecture
# Google Chrome only supports amd64, so use Chromium for arm64
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      wget -q "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_VERSION}_amd64.deb" \
      && apt-get update \
      && apt-get install -y --no-install-recommends ./google-chrome-stable_${CHROME_VERSION}_amd64.deb \
      && rm google-chrome-stable_${CHROME_VERSION}_amd64.deb; \
    else \
      apt-get update \
      && apt-get install -y --no-install-recommends chromium=${CHROMIUM_VERSION} \
      && apt-mark hold chromium; \
    fi \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/agent-sandbox-browser /usr/local/bin/agent-sandbox-browser

EXPOSE 9222 5900 6080

CMD ["agent-sandbox-browser"]
