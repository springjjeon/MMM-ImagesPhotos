#!/bin/bash
set -euo pipefail

# MMM-ImagesPhotos 업로드 서버 시작 스크립트 (PM2 기반)
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="mmm-images-upload-server"
APP_SCRIPT="$APP_DIR/uploadServer/index.js"

if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 is not installed. Run: npm install -g pm2"
    exit 1
fi

EXTRA_ARGS=()
if [[ "${1:-}" == "--watch" ]]; then
    EXTRA_ARGS+=(
        --watch
        --ignore-watch="**/node_modules"
        --ignore-watch="**/.git"
        --ignore-watch="**/uploads"
        --ignore-watch="**/.temp-uploads"
        --ignore-watch="**/mobileUpload"
    )
    echo "🚀 Starting upload server with PM2 (watch mode enabled)..."
else
    echo "🚀 Starting upload server with PM2 (production mode)..."
fi

pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

pm2 start "$APP_SCRIPT" \
    --name "$APP_NAME" \
    --cwd "$APP_DIR/uploadServer" \
    --max-memory-restart 300M \
    --restart-delay 3000 \
    "${EXTRA_ARGS[@]}"

pm2 list
echo "✅ Upload server is managed by PM2 as '$APP_NAME' (port 8999)."
