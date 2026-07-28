#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="agent-sandbox-browser:bookworm-slim"

docker build -t "${IMAGE_NAME}" .
echo "Built ${IMAGE_NAME}"
echo ""
echo "IMPORTANT: Run with --shm-size=2gb (or larger) to prevent click timeouts"
echo ""
echo "Example:"
echo "  docker run -d --shm-size=2gb -p 9222:9222 ${IMAGE_NAME}"
