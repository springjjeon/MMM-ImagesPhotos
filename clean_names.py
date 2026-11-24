import os
import re
import sys
import uuid

# 정리할 대상 폴더 경로 (스크립트 위치 기준 uploads 폴더, 인자 전달 시 해당 경로 사용)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TARGET_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SCRIPT_DIR, "uploads")


def clean_string(text):
    # 1. 공백을 언더바(_)로 변경
    text = text.replace(" ", "_")
    # 2. 영문, 숫자, ., _, -, ! 를 제외한 모든 문자(한글 포함) 제거 (숨기기 기호 ! 보존)
    text = re.sub(r"[^a-zA-Z0-9._!-]", "", text)
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
                new_name_base = "img_" + str(uuid.uuid4())[:8]

            new_filename = f"{new_name_base}{ext}"

            if filename != new_filename:
                old_path = os.path.join(root, filename)
                new_path = os.path.join(root, new_filename)

                counter = 1
                while os.path.exists(new_path):
                    new_path = os.path.join(root, f"{new_name_base}_{counter}{ext}")
                    counter += 1

                print(f"[파일] {filename} -> {os.path.basename(new_path)}")
                os.rename(old_path, new_path)

        # 2. 폴더 이름 변경
        for dirname in dirs:
            new_dirname = clean_string(dirname)

            if len(new_dirname) == 0:
                new_dirname = "folder_" + str(uuid.uuid4())[:8]

            if dirname != new_dirname:
                old_path = os.path.join(root, dirname)
                new_path = os.path.join(root, new_dirname)

                counter = 1
                while os.path.exists(new_path):
                    new_path = os.path.join(root, f"{new_dirname}_{counter}")
                    counter += 1

                print(f"[폴더] {dirname} -> {new_dirname}")
                os.rename(old_path, new_path)


if __name__ == "__main__":
    if not os.path.exists(TARGET_DIR):
        print(f"오류: '{TARGET_DIR}' 폴더를 찾을 수 없습니다.")
        sys.exit(1)
    else:
        print(f"--- 파일명 정리 시작: {TARGET_DIR} (공백 -> _, 한글제거) ---")
        rename_recursive(TARGET_DIR)
        print("--- 완료 ---")
