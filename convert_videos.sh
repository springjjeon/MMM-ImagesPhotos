#!/bin/bash
set -u

TARGET_DIR="/home/pi/MagicMirror/modules/MMM-ImagesPhotos/uploads"

process_file() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "⚠️  파일을 찾을 수 없습니다: $file"
        return
    fi

    local codec
    local pix_fmt
    local width
    codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    pix_fmt=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    width=${width:-0}

    # 변환 조건: h264 코덱이 아니거나, yuv420p 픽셀 포맷이 아니거나, 너비가 900px를 초과하거나, .mov 확장자인 경우
    if [ "$codec" != "h264" ] || [ "$pix_fmt" != "yuv420p" ] || [ "$width" -gt 900 ] || [[ "${file,,}" == *.mov ]]; then
        echo "🔄 변환 중: $(basename "$file")"

        local temp_file="${file%.*}_converted.mp4"

        # FFmpeg 7.x 최적화: -nostdin(배치 입력 보호), -threads 3(슬라이드쇼 여유 코어 확보), faststart
        ffmpeg -nostdin -i "$file" -threads 3 -c:v libx264 -preset fast -crf 23 -profile:v main -pix_fmt yuv420p -vf "scale='min(720,iw)':-2" -c:a aac -b:a 128k -movflags +faststart -y -hide_banner -loglevel error "$temp_file"

        if [ $? -eq 0 ] && [ -s "$temp_file" ]; then
            rm -f "$file"
            mv "$temp_file" "${file%.*}.mp4"
            echo "✅ 완료: $(basename "${file%.*}.mp4")"
        else
            echo "❌ 에러: $(basename "$file") 변환 실패."
            rm -f "$temp_file"
        fi
    else
        echo "⚡ 통과: $(basename "$file") (이미 최적화된 영상입니다)"
    fi
}

if [ -n "${1:-}" ]; then
    echo ">>> [시작] 지정된 동영상 파일에 대한 최적화 변환을 시작합니다..."
    process_file "$1"
else
    echo ">>> [시작] 동영상 정밀 검사 및 매직미러 최적화 변환을 시작합니다..."
    find "$TARGET_DIR" -type f \( -iname "*.mp4" -o -iname "*.mov" \) | while IFS= read -r file; do
        process_file "$file"
    done
fi

echo ">>> [완료] 모든 동영상 처리가 끝났습니다!"
