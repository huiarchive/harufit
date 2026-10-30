# 하루핏 (DayFit)

출발지와 가고 싶은 지역을 고르면, 한국관광공사 API에서 관광지를 불러와 **직선거리가 가까운 순서**로 보여주는 웹앱이에요.
(이후 단계: 찜하기 → 체류 가능 시간 계산 → 길찾기·날씨 연동)

## 시작하기
1. `gas/Code.gs`를 Google Apps Script에 붙여 넣고, 스크립트 속성 `TOUR_API_KEY`(공공데이터포털 인증키)와 `KAKAO_REST_KEY`(카카오 REST API 키)를 저장한 뒤 웹 앱으로 배포해요. (인증키는 GitHub에 올리지 않아요)
2. 배포된 웹 앱 주소(`…/exec`)를 `js/config.js`의 `PROXY_URL`에 넣어요.
3. Firebase 콘솔에서 Realtime Database를 만들고 Authentication의 '익명' 로그인을 사용 설정한 뒤, `firebase.rules.json`의 규칙을 붙여 넣은 뒤, 웹 앱 설정값을 `js/firebase-config.js`에 넣어요.
4. VS Code의 Live Server 같은 로컬 서버로 `index.html`을 열어 확인해요.
5. GitHub 저장소에 올리고 Settings → Pages에서 배포해요. (`gas/` 폴더는 올려도, 안 올려도 돼요)

## 파일별 역할
| 파일 | 역할 |
|---|---|
| `index.html` | 화면 뼈대, Tailwind 설정, 스크립트 불러오기 |
| `gas/Code.gs` | GAS 프록시 — 인증키 은닉, 공공데이터 중계·카카오 동네 검색(geocode), 필드 정리, 6시간 캐싱 |
| `js/config.js` | 프록시 주소·제외할 유형 등 설정값 |
| `js/regions.js` | 시/도·시/군/구 대표 좌표와 지역코드 |
| `js/geo.js` | Haversine 직선거리 계산 |
| `js/api.js` | 프록시 호출, 오류 처리, 30분 브라우저 캐싱 |
| `js/places.js` | API 응답 → 화면용 데이터 (필터링, 거리 계산, 정렬) |
| `js/app.js` | 선택 상자, 스켈레톤·빈 화면·오류 화면, 카드 렌더링 |
| `detail.html` | 장소 상세 페이지 — 소개 글, 체류 시간, 날씨, 혼잡도 제보 |
| `js/detail.js` | 상세 페이지 화면 (목록에서 넘겨받은 정보 + 관광공사 상세 조회) |
| `js/crowd-logic.js` | 혼잡도 집계(최근 2시간)·백분율·대기시간 계산 |
| `js/crowd-ui.js` | 혼잡도 제보 화면 (저장소는 바깥에서 주입) |
| `js/firebase-store.js` | Firebase Realtime Database 연결 (제보 저장, 실시간 구독) |
| `js/firebase-config.js` | Firebase 웹 앱 설정값 |
| `js/travel.js`, `js/weather.js` | 체류 시간 계산, 날씨 표시·실내/야외 규칙 |
| `firebase.rules.json` | 데이터베이스 보안 규칙 (읽기 공개, 형식이 맞는 새 제보만 쓰기) |
| `mypage.html` | 찜한 곳 보관함 — 지금 기준의 이동시간·날씨·혼잡도와 함께 보여줘요 |
| `js/mypage.js` | 보관함 화면 (비 예보가 있는 야외 장소는 뒤로 정렬) |
| `js/likes.js` | 찜하기 저장소 (기본 localStorage, Firebase 연결 시 교체) + 안내 토스트 |
| `js/firebase-boot.js` | 모든 페이지에서 Firebase(익명 로그인)에 연결해 찜하기 저장소를 교체 |
| `ranking.html` | 인기 랭킹 — 찜 수 TOP과 지금 제보가 많은 곳, 방금 올라온 제보 (실시간) |
| `js/ranking.js` | 랭킹 화면 (CSS 막대 그래프) |
| `js/ranking-logic.js` | 인기 랭킹 계산 — 장소별 '찜한 계정 목록'의 크기를 찜 수로 써서, 여러 번 눌러도 숫자가 틀어지지 않아요 |
| `course.html` | 하루 코스 — 찜한 곳 2~4곳의 방문 순서·구간별 이동시간·체류 시간표, 공유 링크 |
| `js/course.js` | 하루 코스 화면 (길찾기·날씨를 받아 시간표를 그려요) |
| `js/course-logic.js` | 방문 순서(모든 경우 비교), 체류 시간 배분, 시간표 계산 |
