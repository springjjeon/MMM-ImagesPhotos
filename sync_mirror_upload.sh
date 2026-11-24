#!/bin/bash

# ================= [설정 구역] =================
# 1. Rclone 설정 이름
REMOTE="gphoto"

# 2. 구글 포토 앨범 경로 (아까 만든 그 앨범!)
ALBUM_PATH="album/MirrorUpload"

# 3. 라즈베리 파이 저장 위치 (절대 경로 추천)
LOCAL_ROOT="/home/pi/MagicMirror/modules/MMM-ImagesPhotos/uploads"

# 4. 파일명 정리 스크립트 위치
CLEANER_SCRIPT="/home/pi/MagicMirror/modules/MMM-ImagesPhotos/clean_names.py"
# ==============================================

echo ">>> [1/3] 구글 포토 'MirrorUpload' 앨범 동기화 시작..."
# 앨범의 사진들을 먼저 'temp_download'라는 임시 폴더로 받아옵니다.
# (이렇게 해야 이미 연도별로 정리된 폴더와 섞이지 않습니다)
rclone sync "$REMOTE:$ALBUM_PATH" "$LOCAL_ROOT/temp_download" --progress --transfers 4

echo ">>> [2/3] 다운로드된 사진을 연도별 폴더(2025, 2026...)로 분류 중..."
# 파이썬 코드를 즉석에서 실행하여 날짜별 분류 수행
python3 - <<EOF
import os
import shutil
import datetime

# 경로 설정
source_dir = "$LOCAL_ROOT/temp_download"
target_root = "$LOCAL_ROOT"

if os.path.exists(source_dir):
    files = os.listdir(source_dir)
    count = 0
    
    for filename in files:
        filepath = os.path.join(source_dir, filename)
        
        # 파일인 경우에만 처리
        if os.path.isfile(filepath):
            try:
                # 파일의 수정 시간(mtime)을 읽어서 연도 추출
                timestamp = os.path.getmtime(filepath)
                date = datetime.datetime.fromtimestamp(timestamp)
                year = str(date.year)
                
                # 연도 폴더가 없으면 생성
                year_dir = os.path.join(target_root, year)
                if not os.path.exists(year_dir):
                    os.makedirs(year_dir)
                
                # 파일 이동 (덮어쓰기 방지 로직은 clean_names에서 처리하므로 여기선 덮어씀)
                target_path = os.path.join(year_dir, filename)
                shutil.move(filepath, target_path)
                count += 1
            except Exception as e:
                print(f"Error moving {filename}: {e}")

    print(f"-> 총 {count}장의 사진을 연도별 폴더로 이동했습니다.")

    # 빈 임시 폴더 삭제
    try:
        os.rmdir(source_dir)
    except:
        pass
else:
    print("-> 다운로드된 새 사진이 없거나 폴더를 찾을 수 없습니다.")
EOF

echo ">>> [3/3] 파일명 한글/공백 제거 및 정리..."
if [ -f "$CLEANER_SCRIPT" ]; then
    python3 "$CLEANER_SCRIPT"
else
    echo "주의: clean_names.py 스크립트를 찾을 수 없습니다."
fi

echo ">>> [완료] 동기화 및 정리가 끝났습니다!"

