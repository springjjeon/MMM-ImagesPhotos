# MMM-ImagesPhotos (Smart Family Photo Frame Edition)

라즈베리파이 5 + [MagicMirror²](https://github.com/MichMich/MagicMirror) 환경에 맞춰 고도화된 **스마트 가족 디지털 액자 모듈** 및 **모바일 원격 리모컨·사진 관리 웹 서버(`uploadServer`)** 프로젝트입니다.

> 원본 [`sdetweil/MMM-ImagesPhotos`](https://github.com/sdetweil/MMM-ImagesPhotos)를 기반으로, 세로형/가로형 대화면 액자 UX, AI 얼굴 인식(YuNet), 2장 스마트 콜라주, 영구 캐시, 모바일 웹 리모컨 및 무중단 관리 기능을 전면 확장했습니다.

![Demo](.github/animate.gif)

---

## 주요 기능

### 1. 스마트 슬라이드쇼 & 추억 가중치
- **가중치 셔플 덱 (`seasonalWeight: 3`)**: Fisher-Yates 셔플로 중복 없이 순회하며, **오늘(±0일)**과 **이맘때(±7일)** 추억 사진은 **3배 가중치**, **즐겨찾기(`★`)** 사진은 추가 `+1` 가중치를 적용합니다. (인접 동일 사진 중복 방지)
- **대형 스포트라이트 배지**: 가중치가 적용된 사진에는 정보 카드 위에 눈에 띄는 배지(`🎂 N년 전 오늘`, `🌸 N년 전 이맘때`, `⭐ 즐겨찾기`)를 분리 표시합니다.
- **부드러운 화면 전환 & 절제된 모션**:
  - 기본 `black` 전환(`검정 1.0초 → 페이드인 1.5초 → 표시 → 페이드아웃 1.5초`) 및 `crossfade` 모드 지원
  - `stillProbability: 0.25` (정지 25% / 15% 이내 부드러운 팬·줌 75%)
  - 고정 QR 오버레이는 전환 시 깜빡이지 않도록 레이어 분리 렌더링
- **동영상 재생**: `.mp4`, `.mov`, `.webm`, `.ogg` 재생 및 `videoPlaybackMultiplier` 길이 조절, 오류 시 자동 스킵 지원

### 2. 방향 자동 대응 2장 콜라주 & AI 얼굴 중심 스마트 크롭
- **모니터 방향 자동 대응 (`enablePortraitCollage`, `collageProbability: 0.5`)**:
  - 세로 모니터(`1080×1920`)에서는 가로 사진 2장을 **상·하 2단** 배치
  - 가로 모니터(`1920×1080`)에서는 세로 사진 2장을 **좌·우 2열** 배치
- **OpenCV 4.10 YuNet 얼굴 중심 스마트 크롭**: `cv2.FaceDetectorYN`(YuNet 2023mar)으로 검출한 얼굴 영역 중심과 머리 위 여백을 계산해 각 콜라주 셀의 `object-position`을 자동 조정하여 얼굴 잘림을 방지합니다.
- **위·아래 각 사진별 개별 전체 정보 표시**: 짝 사진(`companion`)까지 메타데이터를 사전 로드해 각 셀마다 촬영일시·한국어 주소·카메라/렌즈/ISO·효과/얼굴 수·스포트라이트 배지를 독립적으로 표시합니다.

### 3. 풍부한 사진 메타정보 & 화면 보호 UX
- **EXIF & 한국어 역지오코딩**: 촬영일시, 한국어 자연 어순 주소(`대한민국` 생략), 카메라 모델, 초점거리·조리개·셔터·ISO, 검출 얼굴 인원수(`N👤`) 표시
- **갤러리 전용 모드 (`galleryMode`)**: 시계·날씨·뉴스·QR·메타정보를 부드럽게 숨겨 사진 감상에만 집중
- **소프트웨어 야간 디밍 (`#mmip-dim-overlay`)**: 모니터 DDC 밝기 잠금 환경에서도 `15%~100%` 밝기 조절 및 주/야간 크론 자동 디밍 지원

### 4. 모바일 앱형 리모컨 & 사진 관리 웹 서버 (`uploadServer`, 포트 `8999`)
- **PWA 홈화면 앱 설치 & 다크모드 + 하단 탭 바**:
  - `manifest.json` 및 `192/512px` 앱 아이콘 내장으로 아이폰·안드로이드 홈화면에 앱처럼 설치 가능
  - 하단 고정 4탭(`🎛️ 리모컨` / `📸 업로드` / `📁 앨범` / `📊 상태`) + 자동/수동 다크모드 지원
  - 외부 서버 없는 오프라인 로컬 PNG QR 코드(`/qr`)
- **실시간 리모컨 & 2장 콜라주 Now Playing**:
  - 현재 재생 중인 사진(콜라주 시 **위·아래 2장 썸네일 동시 표시**)을 보며 각 사진별 **⬇️ 폰에 원본 저장(`/download/*`)**, **⭐ 개별 즐겨찾기**, **🙈 개별 숨기기** 지원
  - `⏮️ 이전`(25장 히스토리) / `⏭️ 다음` / `⏯️ 일시정지` / `🖼️ 갤러리 모드` / 화면 전원 ON·OFF
  - 재생 필터(`전체` / `즐겨찾기만` / `인물만` / `동영상만` / `폴더 선택`), 전환 속도(`5/9/20/30초`), 소프트웨어 디밍 밝기(`15~100%`) 즉시 반영
- **가상 앨범 & 무새로고침 사진 관리 (`/manage/photos`)**:
  - **전체 통합 가상 앨범**(`⭐ 전체 즐겨찾기`, `🆕 최근 촬영순`, `🎬 전체 동영상`) + 파일명·날짜 실시간 검색/필터
  - `📺 띄우기`, `★ 즐겨찾기`, `🙈 숨김/표시`, `🗑️ 삭제`, `☑️ 일괄 선택 작업` 모두 **Ajax 무새로고침** 처리
  - **터치 스와이프 전체화면 뷰어**: 좌·우 스와이프 탐색, **🔄 90° 회전 저장**(Pillow EXIF 보존), **⬇️ 원본 저장**, `📺 띄우기` / `📌 띄우고 고정`
  - Pillow `360px` 고속 썸네일 캐시 & 전체 사전 생성 스크립트(`prewarm-thumbs.js`)
- **스마트 XHR 업로드 & 무중단 갱신**:
  - 업로드 전 썸네일 미리보기(개별 제외 `×`) + **실시간 전송률(`%`, MB) 진행 바**
  - 아이폰 `.heic`/`.heif` → `.jpg` 자동 변환, 동영상 FFmpeg 7.x 백그라운드 최적화 큐, MagicMirror 무중단 목록 갱신

### 5. 고속 영구 캐시 아키텍처
- `.cache/` 디렉터리에 원자적 JSON 캐시 저장(얼굴 검출, 역지오코딩, EXIF 촬영일, 64KB 헤더 이미지 크기, 즐겨찾기, 밝기, 디스플레이 상태)으로 재부팅 후에도 `~1ms` 수준의 빠른 응답을 유지합니다.

---

## 권장 실행 환경

- **하드웨어**: Raspberry Pi 5 (8GB RAM 권장)
- **OS**: Debian GNU/Linux 13 (`trixie`) / Raspberry Pi OS (64-bit)
- **런타임 & 도구**:
  - Node.js `v22+` / `v24`, PM2
  - Python `3.11+` (`python3-opencv` 4.10+, `python3-pil`)
  - `ffmpeg`, `ddcutil` (HDMI 전원 제어 시)

---

## 설치 및 실행

### 1. 모듈 설치
```bash
cd ~/MagicMirror/modules
git clone https://github.com/springjjeon/MMM-ImagesPhotos.git
cd MMM-ImagesPhotos
npm install
cd uploadServer && npm install
```

### 2. 얼굴 인식 모델 설정 (선택, 권장)
OpenCV 4.10+ 환경에서는 공식 **YuNet 2023mar** 모델(`face_detection_yunet_2023mar.onnx`)을 권장하며, 미지원 환경에서는 Caffe SSD / Haar Cascade로 자동 폴백됩니다.

```bash
sudo apt-get install -y python3-opencv python3-pil ffmpeg
mkdir -p ~/.local/share/models
curl -fsSL -o ~/.local/share/models/face_detection_yunet_2023mar.onnx \
  https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
```

### 3. 모바일 업로드·리모컨 서버 실행 (PM2)
```bash
./start-upload-server.sh
pm2 save
```

---

## MagicMirror² 설정 예시 (`config/config.js`)

```javascript
{
  module: "MMM-ImagesPhotos",
  position: "fullscreen_below",
  config: {
    path: "uploads/",
    updateInterval: 9000,
    transitionMode: "black",          // "black" | "crossfade"
    stillProbability: 0.25,           // 25% 정지, 75% 팬/줌
    enablePortraitCollage: true,      // 모니터 방향 대응 2장 콜라주
    collageProbability: 0.5,          // 50% 콜라주, 50% 단독
    seasonalWeight: 3,                // 오늘·±7일 추억 사진 3배 가중치
    showExif: true,
    faceDetection: true,
    enableVideoPlayback: true,
    videoPlaybackMultiplier: 1.2,
    showUploadQrCode: true,
    uploadPort: 8999,
    qrCodePosition: "bottom_left",
    language: "ko"
  }
}
```

### 주요 설정 옵션

| 옵션 | 설명 | 기본값 |
| --- | --- | --- |
| `path` | 사진·동영상 폴더 경로 (비우면 모듈 내 `uploads/`) | `""` |
| `updateInterval` | 사진 전환 주기 (ms, 리모컨에서 실시간 변경 가능) | `5000` |
| `transitionMode` | 전환 방식 (`"black"` 또는 `"crossfade"`) | `"black"` |
| `stillProbability` | 정지(`ip-still`) 효과 비율 (`0.0 ~ 1.0`) | `0.25` |
| `enablePortraitCollage` | 모니터 방향에 맞춘 2장 콜라주 활성화 여부 | `true` |
| `collageProbability` | 짝을 맞출 수 있을 때 콜라주 표시 확률 (`0.0 ~ 1.0`) | `0.5` |
| `seasonalWeight` | 오늘(±0일)·이맘때(±7일) 추억 사진 셔플 가중치 배수 | `3` |
| `showExif` | 촬영일시·위치·카메라·효과 메타정보 및 스포트라이트 배지 표시 | `true` |
| `faceDetection` | Python OpenCV 얼굴 검출 및 스마트 크롭/줌 활성화 | `true` |
| `enableVideoPlayback` | `.mp4`/`.mov`/`.webm`/`.ogg` 동영상 재생 활성화 | `true` |
| `videoPlaybackMultiplier` | 이미지 대비 동영상 표시 시간 배수 | `1.2` |
| `showUploadQrCode` | 모바일 업로드·리모컨 접속용 로컬 QR 오버레이 표시 | `true` |
| `uploadPort` | `uploadServer` 포트 번호 | `8999` |
| `sequential` | `true`면 이름순, `false`면 가중치 셔플 덱 | `false` |

> 폴더명이나 파일명 앞에 `!`를 붙이면 슬라이드쇼에서 자동으로 숨김 처리됩니다.

---

## 상세 아키텍처 & 변경 이력

- 내부 제어 API, 영구 캐시 구조, 개발 규칙 등 상세 기술 문서는 [GEMINI.md](GEMINI.md)를 참고하세요.
- 변경 이력은 [CHANGELOG.md](CHANGELOG.md) 및 Git 커밋 히스토리에서 확인할 수 있습니다.

## License & Credits

- Original module by [sdetweil/MMM-ImagesPhotos](https://github.com/sdetweil/MMM-ImagesPhotos)
- Built for [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror)
