#!/bin/bash

# MMM-ImagesPhotos 업로드 서버 시작 스크립트

UPLOAD_SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPLOAD_SERVER="$UPLOAD_SERVER_DIR/uploadServer/index.js"
PID_FILE="/tmp/mmm-images-upload-server.pid"

# 이미 실행 중인지 확인
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "✅ Upload server is already running (PID: $OLD_PID)"
        exit 0
    fi
fi

# 서버 시작
echo "🚀 Starting upload server..."
cd "$UPLOAD_SERVER_DIR"
nohup node uploadServer/ > /tmp/mmm-images-upload.log 2>&1 &
SERVER_PID=$!

# PID를 파일에 저장
echo $SERVER_PID > "$PID_FILE"

# 포트 열림 확인
sleep 2
if nc -z localhost 8999 2>/dev/null; then
    echo "✅ Upload server started successfully (PID: $SERVER_PID)"
    echo "📷 Access: http://localhost:8999/"
else
    echo "❌ Failed to start upload server"
    cat /tmp/mmm-images-upload.log
    exit 1
fi
