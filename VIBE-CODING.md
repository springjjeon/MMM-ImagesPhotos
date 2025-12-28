# Vibe Coding — MMM-ImagesPhotos

이 문서는 `MMM-ImagesPhotos` 모듈의 개발/유지보수 지침을 담습니다. 모듈별로 고유 규칙을 기록하고 PR로 변경을 관리하세요.

## 목적
- 모듈의 일관된 코드 스타일과 동작 규칙을 제공하여 유지보수를 쉽게 합니다.
- 사진 효과(전환, 배경색, 애니메이션) 관련 결정과 성능 고려사항을 중앙화합니다.

## 범위
- 이 파일은 `modules/MMM-ImagesPhotos` 디렉터리 내부의 변경에 적용됩니다.

## 코드 스타일
- 프로젝트 전체의 ESLint/Prettier 설정을 따릅니다 (루트의 `eslint.config.mjs`, `prettier.config.mjs`).
- JavaScript: ES2018+ 규칙, `const`/`let` 사용, 함수명/변수명은 camelCase.
- CSS: 모듈 scoped 클래스(`.mmip-...`)를 사용하여 전역 스타일 충돌을 피합니다.

## 효과 규칙
- 전환 순서: 검정(black) → 페이드인 → 표시 → 페이드아웃.
- 기본 타이밍(권장): 검정 1000ms, 페이드인 1000ms, 표시 5000ms, 페이드아웃 1000ms.
- 효과 목록(권장): zoom, pan(up/down/left/right), zoom-pan, fade, grayscale, sepia, rotate — 각 효과는 성능을 고려해 GPU에서 처리하도록 `transform`/`opacity` 사용.
- **이동(Pan) 효과 규칙**: 이동 애니메이션 적용 시 이미지 가장자리가 보이지 않도록, `transform: scale(1.15)`와 같이 이미지를 미리 확대해야 함. 이동 거리는 확대된 여백 이내여야 함.
- 애니메이션 지속시간은 이미지 표시 시간과 충돌하지 않도록 설정.
- 배경색은 이미지의 평균 색을 사용하되, cross-origin 이미지의 경우 캔버스 읽기 실패가 발생할 수 있음.
  - 필요 시 이미지에 `crossOrigin = 'Anonymous'`를 설정하고 서버에 CORS 헤더(`Access-Control-Allow-Origin: *`)가 있는지 확인.

## 성능 고려사항
- 이미지 처리(크기 조정, 캔버스 샘플링)는 가벼운 샘플 사이즈(예: 40×40)로 제한.
- 애니메이션은 `will-change`, `transform`, `opacity`를 활용하여 레이어 생성 비용을 줄임.
- Raspberry Pi 등 저사양 환경에서는 효과 개수/타이밍을 완화.

## 테스트 및 디버깅
- 로컬 실행: MagicMirror를 재시작하거나 모듈을 리로드하여 변경 확인.
- 로그: `Log.log`, `Log.warn`, `Log.error`를 사용해 이미지 로드/전환 시점 로그 기록.
- DevTools: Electron(또는 브라우저) 개발자 도구에서 콘솔과 네트워크, CORS 오류 확인.
- 재현 체크리스트:
  - 외부 URL 이미지의 경우 CORS로 인해 평균색 계산 실패 여부 확인.
  - 캐시된 이미지의 `onload` 호출 여부 확인(핸들러는 `src` 설정 전에 등록).

## 배포·릴리스
- 모듈 변경은 브랜치로 만들고 PR로 병합.
- 릴리스 시 `CHANGELOG.md`에 변경 요약 추가.
- 모듈 `package.json`에 필요한 경우 버전 업데이트.

## Git / 커밋 규칙
- 브랜치: `feature/<짧은-설명>`, `fix/<이슈-번호>-desc`.
- 커밋 메시지: `type(scope): subject` 스타일 권장 (예: `feat(images): add average-color background`).
- 작은 단위의 커밋으로 가독성을 높일 것.

## 갱신 절차
- 이 문서 변경은 PR로 관리하며, 변경 사항은 `CHANGELOG.md`에 반영.
- 중요한 알고리즘(예: 평균색 계산 방식) 변경 시 테스트 케이스와 성능 측정을 첨부.

## 참고
- 프로젝트 루트의 ESLint/Prettier 설정을 따르세요.
- 관련 파일: `MMM-ImagesPhotos.js`, `MMM-ImagesPhotos.css`, `node_helper.js`.

---
*작성일: 2025-12-28*
