# STATUS-BOARD Firebase v6.0.0

GitHub Pages에 바로 올릴 수 있는 행사 준비 현황판입니다.

## v6 디자인 변경

- OpenAI 로고나 브랜드 요소 없이, 미니멀한 GPT 계열 인터페이스 분위기만 참고했습니다.
- 왼쪽 사이드바에 `전체 보기`와 카테고리 목록을 배치했습니다.
- 상단에는 `Excel 내려받기`, `목록 관리`, `권한 관리`, 프로필만 표시합니다.
- 이메일, 관리자 배지, 상단 `+ 항목`, 상단 로그아웃 버튼을 제거했습니다.
- 이메일과 역할, 로그아웃은 프로필 메뉴 안에서 확인합니다.
- 카테고리별 `+ 항목 추가` 버튼은 그대로 유지합니다.
- 항목 순서는 행을 드래그하거나 ↑/↓ 버튼으로 바로 변경할 수 있습니다.
- 모바일에서는 왼쪽 목록이 슬라이드 메뉴로 열립니다.

## 기존 데이터 안전성

이 버전은 UI와 화면 탐색 구조를 변경한 버전입니다.

- Firebase 프로젝트 ID: `status-board-d2b05` 유지
- 컬렉션: `categories`, `tasks`, `members` 유지
- 항목 필드: `title`, `status`, `dueDate`, `memo`, `order`, `categoryId` 유지
- 앱 실행 시 기존 데이터를 삭제하거나 초기화하는 코드가 없습니다.
- `기본 목록 만들기`도 데이터가 완전히 비어 있을 때 관리자가 직접 눌러야만 실행됩니다.

따라서 GitHub 파일을 덮어써도 Firestore에 등록한 기존 데이터는 삭제되지 않습니다. 실제 데이터 삭제는 화면에서 삭제 버튼을 누르고 확인한 경우에만 발생합니다.

## 업로드 방법

ZIP을 풀고 폴더 안의 파일을 GitHub 저장소 최상위에 모두 덮어쓰세요.

```text
STATUS-BOARD/
├── index.html
├── styles.css
├── config.js
├── app.js
├── firestore.rules
├── firebase.json
├── 404.html
├── README.md
├── DATA-SAFETY.md
└── VERSION.txt
```

업로드 후 GitHub Pages에서 강력 새로고침하세요.

- Windows: `Ctrl + Shift + R`
- Mac: `Command + Shift + R`

## Firestore 규칙

v5.1.1에서 신규 로그인 사용자가 승인 대기 상태로 정상 등록되고 있다면, 이번 v6은 보안 규칙 변경이 없으므로 다시 게시할 필요가 없습니다.

`firestore.rules`는 백업과 신규 설치를 위해 ZIP에 함께 포함했습니다.

## 관리자

`bctf.sh@gmail.com`
