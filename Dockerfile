FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Detect architecture and set variables
ARG TARGETARCH

# Pinned Chrome version (amd64) and Chromium version (arm64)
ARG CHROME_VERSION=150.0.7871.186-1
ARG CHROMIUM_VERSION=150.0.7871.181-1~deb12u1

# Install dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    gnupg \
    novnc \
    socat \
    unzip \
    websockify \
    wget \
    x11-utils \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

# Install Chrome/Chromium based on architecture
# Google Chrome only supports amd64, so use Chromium for arm64
# amd64: pinned version downloaded directly for reproducible builds
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

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash \
  && mv /root/.bun/bin/bun /usr/local/bin/

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN bun install

# Copy source code
COPY src ./src

EXPOSE 9222 5900 6080

CMD ["bun", "run", "start"]
