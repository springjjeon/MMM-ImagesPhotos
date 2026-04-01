#!/bin/bash

# MMM-ImagesPhotos 업로드 서버 시작 스크립트 (PM2 기반)

# 스크립트의 실제 경로를 기준으로 디렉터리 설정
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="mmm-images-upload-server"
APP_SCRIPT="$APP_DIR/uploadServer/index.js"

echo "🚀 Starting or restarting upload server with PM2..."

# PM2가 설치되어 있는지 확인
if ! command -v pm2 &> /dev/null
then
    echo "❌ PM2 is not installed."
    echo "Please install it globally by running: npm install -g pm2"
    exit 1
fi

# PM2를 사용하여 앱 시작 또는 재시작
# --watch: 파일 변경 시 자동 재시작
# --ignore-watch: watch에서 제외할 폴더/파일 지정
# --cwd: 실행 디렉토리 설정
pm2 start "$APP_SCRIPT" \
    --name "$APP_NAME" \
    --watch \
    --ignore-watch="**/node_modules" \
    --ignore-watch="**/.git" \
    --ignore-watch="**/uploads" \
    --ignore-watch="**/mobileUpload" \
    --cwd "$APP_DIR/uploadServer" \
    --restart-delay 3000

# 상태 확인
echo ""
pm2 list

echo ""
echo "✅ Upload server is now managed by PM2 under the name '$APP_NAME'."
echo "📷 Access: http://<Your-MagicMirror-IP>:8999"
echo "📜 To check logs, run: pm2 logs $APP_NAME"
echo "🛑 To stop the server, run: pm2 stop $APP_NAME"
echo "💾 To save the process list for automatic startup on boot, run: pm2 save"
