#!/bin/bash

TARGET_DIR="/home/pi/MagicMirror/modules/MMM-ImagesPhotos/uploads"

# 함수: 단일 파일을 검사하고 변환
process_file() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "⚠️  파일을 찾을 수 없습니다: $file"
        return
    fi

    local codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    local pix_fmt=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    local width=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$file" 2>/dev/null)
    width=${width:-0}

    # 변환 조건: h264 코덱이 아니거나, yuv420p 픽셀 포맷이 아니거나, 너비가 900px를 초과하거나, 파일 확장자가 .mov인 경우
    if [ "$codec" != "h264" ] || [ "$pix_fmt" != "yuv420p" ] || [ "$width" -gt 900 ] || [[ "${file,,}" == *.mov ]]; then
        echo "🔄 변환 중: $(basename "$file")"

        local temp_file="${file%.*}_converted.mp4"

        # 🔇 ffmpeg의 모든 로그와 경고 메시지를 완전히 숨깁니다.
        ffmpeg -i "$file" -c:v libx264 -preset fast -profile:v main -pix_fmt yuv420p -vf "scale='min(720,iw)':-2" -c:a aac -b:a 128k -movflags +faststart -y -hide_banner -loglevel quiet "$temp_file" 2>/dev/null

        if [ $? -eq 0 ]; then
            # 원본 파일 삭제 후 변환된 파일로 교체
            rm "$file"
            mv "$temp_file" "${file%.*}.mp4"
            echo "✅ 완료: $(basename "${file%.*}.mp4")"
        else
            echo "❌ 에러: $(basename "$file") 변환 실패."
            rm -f "$temp_file" # 실패 시 임시 파일 삭제
        fi
    else
        echo "⚡ 통과: $(basename "$file") (이미 최적화된 영상입니다)"
    fi
}

# 인자가 있는지 확인
if [ -n "$1" ]; then
    # 인자가 있으면 해당 파일만 처리
    echo ">>> [시작] 지정된 동영상 파일에 대한 최적화 변환을 시작합니다..."
    process_file "$1"
else
    # 인자가 없으면 기존 방식대로 폴더 전체를 처리
    echo ">>> [시작] 동영상 정밀 검사 및 매직미러 최적화 변환을 시작합니다..."
    find "$TARGET_DIR" -type f \( -iname "*.mp4" -o -iname "*.mov" \) | while read -r file; do
        process_file "$file"
    done
fi

echo ">>> [완료] 모든 동영상 처리가 끝났습니다!"
