# MMM-ImagesPhotos 개발 및 유지보수 지침 (AI Context)

이 문서는 라즈베리파이 전자 액자용 커스텀 `MMM-ImagesPhotos` 모듈의 구조, 확정된 사용자 선호 규칙, 캐시/API 설계, 주의사항을 정리한 기준 문서입니다.

*마지막 수정일: 2026-11-25*

---

## 1. 모듈 전체 구성

```text
MMM-ImagesPhotos/
├── MMM-ImagesPhotos.js       # 프론트엔드 슬라이드쇼, 셔플 덱, 콜라주·스마트크롭, 리모컨, EXIF/배지/디밍/QR
├── MMM-ImagesPhotos.css      # 애니메이션, 콜라주 그리드, 대형 스포트라이트 배지, 유리 질감(.exif-info/.mmip-*)
├── node_helper.js            # 미디어 스캔, 영구 캐시, EXIF/GPS/얼굴인식(짝사진 포함), 내부 제어 HTTP API
├── clean_names.py            # 업로드 파일/폴더명 정규화 (스크립트 위치 기준 uploads/ 자동 탐색)
├── clean_extensions.sh       # 비미디어 잔여 파일 정리 (--dry-run 지원, 동영상 보호)
├── convert_videos.sh         # FFmpeg 7.x 동영상 최적화 (-nostdin, -threads 3, -crf 23, h264/yuv420p/720p)
├── start-upload-server.sh    # PM2 프로덕션 실행 스크립트 (--watch 옵션 지원, 메모리 상한 300M)
├── sync_mirror_upload.sh     # rclone 구글 포토 동기화 보조 스크립트
├── .cache/                   # (Git 제외) 영구 JSON 캐시 및 360px 썸네일 저장소
│   ├── face-detection-cache.json
│   ├── geocode-cache.json
│   ├── exif-date-cache.json
│   ├── dimensions-cache.json
│   ├── favorites.json
│   ├── brightness.json
│   ├── display-state.json
│   └── thumbs/
└── uploadServer/             # 독립 모바일 웹 서버 (포트 8999, PM2: mmm-images-upload-server)
    ├── index.js              # Express 진입점, /qr(로컬 PNG), /thumb/*(360px 캐시), /uploads
    ├── routes/
    │   ├── main.js           # 메인 페이지(/), 다중 업로드(/upload, HEIC->JPG, 비동기 동영상 큐)
    │   └── management.js     # 폴더/사진 관리(/manage/*), 리모컨·밝기·필터·즉시띄우기 API, 상태 대시보드
    ├── lib/
    │   ├── file-utils.js     # 폴더/파일 목록, EXIF 촬영일 정렬, 보이기/숨기기(!접두사), 삭제 유틸
    │   ├── process-utils.js  # 무중단 목록 갱신(notifyMagicMirrorRefresh), MagicMirror API 호출, PM2 재시작
    │   ├── thumb-utils.js    # Pillow 11 기반 360px JPEG 썸네일 비동기 생성(동시 4워커) & SHA-1 캐싱
    │   ├── video-queue.js    # 동영상 백그라운드 순차 변환 큐 & 완료 시 무중단 갱신
    │   └── view-renderer.js  # HTML 템플릿({{placeholder}}) 렌더러
    └── views/
        ├── index.html        # 리모컨(재생/필터/속도/밝기/갤러리모드) + 업로드 + 시스템 대시보드 + 폴더 관리
        └── manage-photos.html # 폴더별 썸네일 그리드 + EXIF 정렬 + 즐겨찾기 + 즉시 액자 띄우기(고정 포함)
```

---

## 2. 확정된 UX / 동작 규칙 (임의 변경 주의)

### 화면 전환 & 애니메이션
- **기본 전환 모드 (`transitionMode: "black"`)**:
  - `검정 화면(1.0초) → 페이드인(1.5초) → 표시(updateInterval) → 페이드아웃(1.5초)`
  - 풀스크린 모드에서는 `updateDom(0)`을 사용해 고정 QR 오버레이(`.mmip-overlay-root`)가 깜빡이지 않도록 유지
  - `config.js`에서 `transitionMode: "crossfade"`로 전환 가능
- **정지 vs 움직임 비율 (`stillProbability: 0.25`)**:
  - 모든 사진에 대해 **25% `ip-still`**, **75% 움직이는 팬/줌 효과** 적용
  - 모든 이동·확대 효과는 **15% (`scale(1.15)` / `translate(15%)`) 이내**로 제한 (`20초 ~ 40초` 무작위 지속)
  - `ip-zoom-pan*`은 `1.05x → 1.15x` 확대와 이동이 동시에 동작
- **가중치 셔플 덱 (`seasonalWeight: 3`)**:
  - `sequential: false`일 때 Fisher-Yates 셔플 덱으로 순회하며, 인접 동일 사진 중복 방지 적용
  - **오늘(±0일) · 이맘때(±7일) 추억 사진만 3배 가중치** (같은 계절 사진 가중치 제외)
  - **즐겨찾기(`★`)** 사진은 추가 `+1` 가중치
  - `photoHistory`로 이전 사진 **최대 25장** 보관 (`⏮️ 이전 사진` 시 콜라주 구성 및 메타데이터 그대로 복원)

### 방향 자동 대응 2장 콜라주 (`enablePortraitCollage: true`, `collageProbability: 0.5`)
- 모니터 방향과 반대 비율의 사진이 나올 때 **50% 확률**로 2장을 짝지어 표시 (50%는 단독 표시)
  - **세로 모니터 (`1080×1920`, 현재 환경)**: 가로 사진 2장을 **상·하 2단(`mmip-collage-vertical`)** 배치
  - **가로 모니터 (`1920×1080`)**: 세로 사진 2장을 **좌·우 2열(`mmip-collage-horizontal`)** 배치
- **짝 사진 사전 메타데이터 로드**: `prepareNextPhoto()` 시점에 짝 사진(`companion`)을 미리 선택해 `node_helper.js`(`enrichPhotoMetadata`)에서 양쪽 사진 모두 EXIF·한국어 주소·얼굴 인식 정보를 사전 로드
- **위·아래 각 사진별 전체 정보 카드**: 각 `.mmip-collage-cell` 우측 하단에 `.mmip-collage-meta-stack.mmip-meta-compact`로 개별 정보 카드 및 스포트라이트 배지 표시
- **YuNet 얼굴 중심 스마트 크롭 (`computeFaceObjectPosition`)**: 검출된 모든 얼굴 영역 중심 + 머리 위 10% 여백 보정으로 각 셀의 `object-position` 자동 계산 (`X: 10~90%`, `Y: 5~85%` 클램핑, 얼굴 미검출 시 `center 25%` 유지)

### 메타정보 박스 (`.exif-info`) & 대형 스포트라이트 배지 (`.mmip-spotlight-pill`)
- 위치: 우측 하단 (단독 `bottom: 16px; right: 16px`, 콜라주 각 셀 `bottom: 14px; right: 14px`), 반투명 유리 질감, **텍스트 왼쪽 정렬(`text-align: left`)**
- **스포트라이트 배지** (`.exif-info` 위 별도 대형 필 배지, 실제 가중치가 적용되는 사진에만 표시):
  - `🎂 N년 전 오늘` (`memoryYearsAgo >= 1`)
  - `🌸 N년 전 이맘때` (`nearMemoryYearsAgo >= 1`, ±7일)
  - `⭐ 즐겨찾기` (`isFavorite`)
- **EXIF 카드 항목** (인식된 항목은 누락 없이 항상 표시, EXIF 없는 사진은 캐시 `dateStr` 폴백):
  - `🗓️ YYYY-MM-DD HH:MM`
  - `📍 위치` — 한국 주소는 큰 단위 → 작은 단위 공백 구분, `대한민국` 생략 (예: `경기도 군포시 군포1동 한세로56번길`)
  - `📷 카메라 모델` / `⚙️ 초점거리·조리개·셔터·ISO`
  - `✨ 효과명 (N👤)` (얼굴 검출 시 인원수 표시)

### 갤러리 모드 · 소프트웨어 디밍 · 재생 필터 · 즉시 띄우기
- **갤러리 전용 모드 (`galleryMode`)**: `body.mmip-gallery-mode`로 모든 위젯·스크림·QR·메타정보·콜라주 카드를 0.45초 부드럽게 숨김/복귀 (`.cache/display-state.json` 영구 저장)
- **소프트웨어 디밍 오버레이 (`#mmip-dim-overlay`)**: BenQ DDC VCP `0x10` 잠금 우회용 `15%~100%` 오버레이 (`.cache/brightness.json` 저장, `~/autoBrightness.sh` 크론 `07:30 100%` / `21:00 40%` 연동)
- **리모컨 재생 필터 (`filterMode`)**: `all` / `favorites` / `faces` / `videos` / `folder` 실시간 전환 (결과 0건 시 전체로 안전 폴백)
- **슬라이드 전환 속도 실시간 조절 (`updateIntervalMs`)**: 리모컨 프리셋(`5초`/`9초`/`20초`/`30초`)으로 재시작 없이 변경 및 영구 저장
- **사진 관리 → 액자 즉시 띄우기**: 사진 카드 `📺` 버튼 또는 미리보기 `📺 액자에 띄우기` / `📌 띄우고 고정`으로 선택한 사진을 단독(`forceSingle: true`)으로 즉시 표시 (페이지 새로고침 없음)

### 미디어 포맷 & 숨김 규칙
- `!`로 시작하는 폴더/파일은 슬라이드쇼에서 숨김 처리 (`node_helper.js` `getFiles()`)
- 지원 MIME (`node_helper.js` `getImages()`): `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/heic`, `video/mp4`, `video/webm`, `video/ogg`, `video/quicktime`
- 아이폰 `.heic`/`.heif` 업로드 시 `uploadServer`에서 `heic-convert`로 `.jpg` 자동 변환

---

## 3. 영구 캐시 & 성능 설계

- **Next Up 프리패치**: 현재 사진 표시 중 다음 사진(및 콜라주 짝 사진)의 EXIF/GPS/얼굴 검출을 백그라운드에서 선행 처리
- **영구 JSON 캐시** (`.cache/`, 3초 디바운스 + `.tmp`→`rename` 원자적 저장, `stop()` 시 플러시):
  - `face-detection-cache.json`: 파일 `mtimeMs`/`size` 기준 YuNet 2023mar 검출 결과 캐시 (전체 1,365장 캐싱 완료, 히트 시 `~1ms`, 15초 타임아웃 보호)
  - `geocode-cache.json`: 소수점 4자리 좌표+언어 키 캐시 (Nominatim 재호출 방지, 10초 타임아웃 보호)
  - `exif-date-cache.json`: EXIF 촬영 연·월·일 캐시 (오늘/이맘때 판별 + 사진 관리 촬영일 정렬)
  - `dimensions-cache.json`: 앞 64KB 헤더 고속 스캔 결과 캐시 (콜라주 가로/세로 즉시 판별)
  - `favorites.json` / `brightness.json` / `display-state.json`: 즐겨찾기, 디밍 밝기, 갤러리 모드·필터·전환 속도 영구 저장
- **리소스 누수 방지**: 전환/일시중지 시 `clearFadeTimers()` 및 `cleanupFaceStyles()`로 이전 타이머·동적 `<style>` 자동 정리

---

## 4. 내부 제어 API (`http://localhost:8080/MMM-ImagesPhotos/api/*`)

MagicMirror 프로세스(`node_helper.js`)가 로컬 전용 제어 API를 제공합니다.

| 메서드/경로 | 동작 |
| --- | --- |
| `GET /MMM-ImagesPhotos/api/status` | 실행 인스턴스, 일시정지 여부, `currentPhoto`, 즐겨찾기 수, 밝기, `displayState`, 각 캐시 개수 반환 |
| `POST /MMM-ImagesPhotos/api/refresh` | `PHOTOS_UPDATED` 소켓 브로드캐스트 (재시작 없는 무중단 목록 갱신) |
| `POST /MMM-ImagesPhotos/api/control` | `{ "action": "next" \| "prev" \| "pause" \| "resume" \| "toggle-pause" }` 실시간 제어 |
| `POST /MMM-ImagesPhotos/api/hide-current` | 현재 표시 중인 사진 파일명에 `!` 접두사 부여 후 목록 갱신 + 다음 사진 전환 |
| `POST /MMM-ImagesPhotos/api/favorite` | `{ "path": "...", "favorite": true/false }` 즐겨찾기 토글 및 배지 즉시 갱신 |
| `GET/POST /MMM-ImagesPhotos/api/brightness` | 소프트웨어 디밍 오버레이 밝기(`15~100`) 조회/적용 및 영구 저장 |
| `GET/POST /MMM-ImagesPhotos/api/display-state` | `galleryMode`, `filterMode`, `filterFolder`, `updateIntervalMs` 조회/적용 및 영구 저장 |
| `POST /MMM-ImagesPhotos/api/show-photo` | `{ "path": "...", "pause": true/false }` 선택한 사진 즉시 단독 표시 (+ 고정 옵션) |

### 무중단 갱신 & 야간 보호 정책 (`uploadServer/lib/process-utils.js`)
- 파일/폴더 변경 시 `notifyMagicMirrorRefresh()` 호출:
  - `pm2 pid mm`이 실행 중이면 `POST http://localhost:8080/MMM-ImagesPhotos/api/refresh`만 호출 (Electron 재시작 없음)
  - `mm`이 중지 상태(야간 `screen-off`)이면 `mm`을 깨우지 않고 그대로 스킵 (다음 `screen-on` 시 자동 반영)
- `restartMagicMirror()`는 웹 UI의 수동 "🔄 MagicMirror 재시작" 버튼에서만 사용

---

## 5. 개발 시 필수 주의사항 (Gotchas)

1. **`localhost` vs `127.0.0.1` (IPv6 바인딩)**:
   - Debian 13 (Trixie) + Node 24 환경에서 MagicMirror `address: "localhost"`는 `[::1]:8080`(IPv6)에 바인딩됩니다. 내부 API 호출 시 반드시 `localhost`를 사용하세요 (`127.0.0.1` 사용 시 `ECONNREFUSED`).
2. **`getScripts()`에 CSS 넣지 않기**:
   - CSS는 `getStyles()`에서만 반환하고 `getScripts()`는 `[]` 유지.
3. **로컬 QR 코드**:
   - 외부 `api.qrserver.com` 대신 `http://<serverIp>:8999/qr?data=...` 사용 (오프라인 호환).
4. **Git 커밋 규칙**:
   - `type(scope): subject` 형식 권장 (예: `feat(collage): ...`, `fix(ui): ...`, `chore(ops): ...`).
   - `.cache/`, `.temp-uploads/`, `uploads/`, `node_modules/`는 `.gitignore`에 의해 제외됨.
