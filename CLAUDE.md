# WHENMUSIC

재생 장치를 갖지 않는 음악 앱. Windows SMTC에 붙어서 **무엇이 흐르는지 읽고, 탭을 찾지 않고 조작하고, 무엇을 들었는지 남긴다.** 소리는 Spotify·브라우저 유튜브·로컬 플레이어가 낸다.

`when630` 시리즈의 다섯 번째 앱이다. 형제 앱은 `D:\when630\`의 `whenwork`·`whennote`·`whencalendar`·`whenmail`.

## 먼저 읽을 것

작업 전에 **`docs/` 3종이 단일 원본**이다. 여기 없는 결정은 내린 적이 없는 것으로 본다.

| 문서 | 내용 |
|---|---|
| `docs/01_프로젝트.md` | 정의·페르소나·스코프·형제 앱 경계 |
| `docs/02_요구사항.md` | 요구사항 ID 59개 (CARD·CTL·STMP·HIST·SRCH·STOR·DATA·PLAT·REL·DONE) |
| `docs/03_기술_스펙.md` | 스택·모듈·데이터 모델·**결정 기록 D-01~D-18**·**실측 로그 §12**·오픈이슈 |

디자인 시안은 `design/mockups/card-options.html`(확정안은 §0의 ㉤), 실측 스크립트는 `poc/`.

## 현재 단계

**Phase 2 — 카드.** CARD·CTL 요구사항을 화면에 붙이는 단계다.

Phase 0(PoC)과 Phase 1(애드온)은 끝났다.
- 포크 **[when630/node-windows-smtc-monitor](https://github.com/when630/node-windows-smtc-monitor) v1.1.0** — 제어 6종(`docs/03_기술_스펙.md` §8)을 노출했고 CI가 x64·ia32·arm64를 빌드해 릴리스에 붙인다
- x64 바이너리는 **`vendor/`에 커밋돼 있다**([D-20](docs/03_기술_스펙.md#d-20-애드온은-npm에-퍼블리시하지-않고-릴리스의-node를-쓴다)). npm 퍼블리시는 하지 않는다. 갱신 방법은 `vendor/README.md`
- `main/session.mjs`에 position 보간·세션 분할·중복 이벤트 판정이 순수 함수로 들어가 있다 (`test/session.test.mjs`)

## 밟으면 아픈 함정 (전부 실측으로 확인된 것)

1. **`timeline.position`은 재생 중 갱신되지 않는다.** 실측에서 8분까지 낡아 있었다. 앱이 직접 보간해야 한다 — `docs/03_기술_스펙.md` §5. 이걸 모르고 그냥 읽으면 진행바가 멈춰 있다
2. **애드온은 Worker thread에서만 만진다.** 메인·렌더러에서 직접 쓰면 프리징한다 (D-16)
3. **SMTC는 곡을 주지 않는다.** 1시간 믹스 영상 하나가 "한 곡"이다. 제목=영상 제목, 아티스트=채널명, 썸네일=16:9 영상 커버. 곡 단위로 설계하면 전부 무너진다 (D-03)
4. **`Try*` 계열은 "요청 수락"만 의미한다.** 상태 반영은 늦으므로 UI를 낙관적으로 먼저 바꾼다 (D-14)
5. **`playback-changed`가 같은 상태로 두 번 온다.** 디바운스하지 않으면 이력이 부풀어 오른다 (D-15)
6. **제목에 유니코드 볼드·이모지·전각 기호가 섞인다.** NFKC 정규화 없이는 검색이 걸리지 않는다 (D-13)
7. **애드온은 콜백을 다 건 뒤에 `initialize()`한다.** 순서를 뒤집으면 **이벤트가 한 건도 오지 않는다.** 그런데 앱은 멀쩡해 보인다 — 카드는 1초마다 보간으로 그려지고, 이력은 재시작할 때마다 새 줄이 생겨 쌓이는 것처럼 보인다. 실제로 하루를 그렇게 보냈다 (D-27)

## 스택

Electron 43 · vanilla JS + CSS(프레임워크 없음) · `node:sqlite` 단일 파일 · electron-builder NSIS · 미서명 GitHub Releases + electron-updater.

형제 앱과 다른 단 하나는 **네이티브 애드온**이다. 그래서 개발 PC에 Rust·MSVC를 두지 않고 **CI에서만 빌드한다**(D-06).

## 규칙

- 다섯 앱은 **코드를 공유하지 않는다.** 검증된 모듈을 복사해 시작하고 각자 진화한다 — `search.mjs`(whennote), 오버레이 창 기법(whencalendar), `place.mjs`·`update.mjs`(whenwork). 공유하는 것은 스택·구조·디자인 토큰·파이프라인·테스트 방식뿐이다 (D-17)
- **디자인 토큰의 단일 원본은 형제 앱 `renderer/tokens.css`다.** whenmusic이 더하는 것은 `--music: #bb9af7` 한 쌍뿐
- 화면 자리: whencalendar가 상단 중앙을 쓰므로 **카드는 우하단 고정** (D-08)
- 단축키: 창 `Ctrl+Alt+P` · 도장 `Ctrl+Alt+S` · 되감기 `Ctrl+Alt+←` (형제 앱과 충돌 없음)
- 새 결정은 `docs/03_기술_스펙.md` §11에 `D-nn`으로 남기고 **폐기안도 함께 적는다**
