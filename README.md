<div align="center">
  <h1>WHENMUSIC</h1>
  <p><b>재생 장치를 갖지 않는 음악 앱. 무엇이 흐르는지 읽고, 탭을 찾지 않고 조작하고, 무엇을 들었는지 남긴다.</b></p>
  <p>Windows 11 · 한국어 · Electron</p>
</div>

---

소리는 Spotify가, 브라우저 유튜브가, 로컬 플레이어가 냅니다. 이 앱은 Windows SMTC(System Media Transport Controls)에 붙어 그 위의 층이 됩니다.

- **조작 비용 0** — 화면 우하단에 상주하는 작은 카드에서 재생·정지·되감기가 끝납니다. 백그라운드 탭을 찾아가지 않습니다
- **되감기** — 좋은 곡이 지나갔을 때 그 자리에서 되감습니다. 키보드 미디어 키에는 없는 동작입니다
- **기록은 내 PC에** — 무엇을 얼마나 들었는지 SQLite 파일 하나에 남습니다. 1년에 한 번 오는 남의 요약을 기다리지 않습니다

단축키 — 창 `Ctrl+Alt+P` · 도장 `Ctrl+Alt+S` · 되감기 `Ctrl+Alt+←`

## 현재 상태

**개발 중. 설치 파일은 아직 없습니다.**

| 단계 | 상태 |
|---|---|
| Phase 0 — PoC | **끝남.** 읽기·세션 지목 제어·절대 시크를 실측으로 확인 (`poc/`) |
| Phase 1 — 애드온에 제어 더하기 | **끝남 (2026-09-18).** 제어 6종을 포크에 노출하고 CI에서 세 타겟을 빌드해 [v1.1.0](https://github.com/when630/node-windows-smtc-monitor/releases/tag/v1.1.0)으로 릴리스. x64 바이너리는 `vendor/` |
| Phase 2 — 카드 | **진행 중.** position 보간과 세션 분할 규칙까지 |
| Phase 3 이후 | 도장 · 이력 창 · 릴리스 |

네이티브 애드온은 [when630/node-windows-smtc-monitor](https://github.com/when630/node-windows-smtc-monitor)(Rust + napi-rs, MIT)를 씁니다. upstream은 [LeagueTavern/node-windows-smtc-monitor](https://github.com/LeagueTavern/node-windows-smtc-monitor)이고, 읽기 전용이라 제어를 더하려고 포크했습니다.

## 문서

결정은 전부 `docs/`에 있습니다. 여기 없는 결정은 내린 적이 없는 것으로 봅니다.

| 문서 | 내용 |
|---|---|
| [01_프로젝트.md](docs/01_프로젝트.md) | 정의·페르소나·스코프·형제 앱 경계 |
| [02_요구사항.md](docs/02_요구사항.md) | 요구사항 ID 59개 |
| [03_기술_스펙.md](docs/03_기술_스펙.md) | 스택·모듈·데이터 모델·결정 기록 D-01~D-18·실측 로그 |

디자인 시안은 [design/mockups/card-options.html](design/mockups/card-options.html), 실측 스크립트는 [poc/](poc/)입니다.

## 스택

Electron 43 · vanilla JS + CSS(프레임워크 없음) · `node:sqlite` 단일 파일 · electron-builder NSIS · 미서명 GitHub Releases + electron-updater.

형제 앱과 다른 단 하나가 네이티브 애드온입니다. 그래서 개발 PC에 Rust·MSVC를 두지 않고 CI에서만 빌드합니다.

## 형제 앱

[WHENWORK](https://github.com/when630/whenwork) · [WHENNOTE](https://github.com/when630/whennote) · [WHENCALENDAR](https://github.com/when630/whencalendar) · [WHENMAIL](https://github.com/when630/whenmail)

다섯 앱은 코드를 공유하지 않습니다. 공유하는 것은 스택·구조·디자인 토큰·파이프라인·테스트 방식입니다.
