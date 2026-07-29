# STATUS-BOARD Firebase v6.0.2

GitHub Pages에 바로 올릴 수 있는 행사 준비 현황판입니다.

행사명: **OpenAI Game Hackathon in Seoul**

- 행사명을 로그인 화면과 상단 바에 표시합니다.
- iPhone Safari에서 홈 화면에 추가한 뒤 실행하면 독립형 웹 앱으로 열립니다.
- 노치와 홈 인디케이터가 있는 화면의 안전영역을 지원합니다.

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

## 권한 모델

- 열람 권한: 현황판을 보기만 할 수 있습니다.
- 편집 권한: 관리자와 동일하게 카테고리, 항목, 상태, 순서, 사용자 권한을 관리할 수 있습니다.
- 관리자: `config.js`에 지정된 소유자 계정이며 항상 전체 권한을 가집니다.

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
├── manifest.webmanifest
├── 404.html
├── README.md
├── DATA-SAFETY.md
└── VERSION.txt
```

업로드 후 GitHub Pages에서 강력 새로고침하세요.

- Windows: `Ctrl + Shift + R`
- Mac: `Command + Shift + R`

## Firestore 규칙

v6.0.1은 편집 권한 범위를 확장했으므로 저장소의 `firestore.rules`를 Firebase에 반드시 다시 게시해야 합니다.

GitHub에 파일을 올리는 것만으로는 Firestore 보안 규칙이 적용되지 않습니다. Firebase Console의 `Firestore Database` → `규칙`에서 `firestore.rules`의 전체 내용을 붙여넣고 `게시`를 누르세요.
