#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${TARGET_DIR:-$SCRIPT_DIR/uploads}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" || "${1:-}" == "-n" ]]; then
    DRY_RUN=true
fi

if [[ ! -d "$TARGET_DIR" ]]; then
    echo "❌ 대상 폴더가 존재하지 않습니다: $TARGET_DIR" >&2
    exit 1
fi

FIND_ARGS=(
    "$TARGET_DIR" -type f
    ! -iname "*.jpg"
    ! -iname "*.jpeg"
    ! -iname "*.png"
    ! -iname "*.gif"
    ! -iname "*.webp"
    ! -iname "*.mp4"
    ! -iname "*.mov"
    ! -iname "*.webm"
    ! -iname "*.ogg"
    ! -name ".gitkeep"
)

if [[ "$DRY_RUN" == true ]]; then
    echo ">>> [DRY-RUN] 삭제 대상 파일 목록:"
    find "${FIND_ARGS[@]}" -print
else
    find "${FIND_ARGS[@]}" -exec rm -v {} +
fi
