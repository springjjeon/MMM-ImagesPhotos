import os
import re
import uuid

# 정리할 대상 폴더 경로 (현재 위치 기준 uploads 폴더)
TARGET_DIR = "./uploads"

def clean_string(text):
    # 1. 공백을 언더바(_)로 변경
    text = text.replace(" ", "_")
    # 2. 영문, 숫자, ., _, -, ! 를 제외한 모든 문자(한글 포함) 제거 (숨기기 기호 ! 보존)
    text = re.sub(r'[^a-zA-Z0-9._!-]', '', text)
    return text

def rename_recursive(directory):
    # 하위 폴더부터 처리하기 위해 topdown=False 설정 (파일 먼저 바꾸고 폴더 바꿈)
    for root, dirs, files in os.walk(directory, topdown=False):

        # 1. 파일 이름 변경
        for filename in files:
            name, ext = os.path.splitext(filename)
            new_name_base = clean_string(name)

            # 한글을 지웠더니 이름이 텅 비어버린 경우 (예: "사진.jpg" -> ".jpg")
            if len(new_name_base) == 0:
                new_name_base = "img_" + str(uuid.uuid4())[:8] # 랜덤 고유ID 부여

            new_filename = f"{new_name_base}{ext}"

            # 이름이 바뀌는 경우에만 실행
            if filename != new_filename:
                old_path = os.path.join(root, filename)
                new_path = os.path.join(root, new_filename)

                # 중복 파일명 방지
                counter = 1
                while os.path.exists(new_path):
                    new_path = os.path.join(root, f"{new_name_base}_{counter}{ext}")
                    counter += 1

                print(f"[파일] {filename} -> {os.path.basename(new_path)}")
                os.rename(old_path, new_path)

        # 2. 폴더 이름 변경
        for dirname in dirs:
            new_dirname = clean_string(dirname)

            # 폴더명이 비게 되면 기본값 설정
            if len(new_dirname) == 0:
                new_dirname = "folder_" + str(uuid.uuid4())[:8]

            if dirname != new_dirname:
                old_path = os.path.join(root, dirname)
                new_path = os.path.join(root, new_dirname)

                # 중복 폴더명 방지
                counter = 1
                while os.path.exists(new_path):
                    new_path = os.path.join(root, f"{new_dirname}_{counter}")
                    counter += 1

                print(f"[폴더] {dirname} -> {new_dirname}")
                os.rename(old_path, new_path)

if __name__ == "__main__":
    if not os.path.exists(TARGET_DIR):
        print(f"오류: '{TARGET_DIR}' 폴더를 찾을 수 없습니다.")
    else:
        print("--- 파일명 정리 시작 (공백 -> _, 한글제거) ---")
        rename_recursive(TARGET_DIR)
        print("--- 완료 ---")
