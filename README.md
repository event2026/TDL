# OpenAI Game Hackathon in Seoul Status Board v6.1.2

GitHub Pages에 바로 배포되는 행사 준비 현황판입니다.

## v6.1 디자인

- 공식 OpenAI 워드마크와 행사명을 로그인 화면 및 상단에 표시합니다.
- 흰 배경, 검정 텍스트, 블루 바이올렛 포인트의 플랫한 화면입니다.
- 카테고리를 접고 펼쳐 필요한 목록만 확인할 수 있습니다.
- 전체 및 카테고리별 완료율을 간단히 표시합니다.
- 완료 체크, 취소선, 상태 표시로 끝난 항목을 분명하게 구분합니다.
- 항목에 선택형 `담당자` 필드를 추가했습니다.
- 기존 항목에 담당자가 없으면 Firestore를 수정하지 않고 `미지정`으로 표시합니다.
- iPhone Safari 홈 화면 추가용 노트 아이콘과 독립 실행 모드를 지원합니다.

## v6.1.1 모바일 로그인 및 메모

- iPhone 홈 화면 모드에서는 Google 전체 화면 리다이렉트 로그인을 사용합니다.
- PC와 일반 브라우저에서는 기존 팝업 로그인을 유지합니다.
- 항목 순서는 제목 옆 손잡이를 드래그해 변경하며 메인 화면의 ↑/↓ 버튼은 제거했습니다.
- 메모를 펼쳐 전체 내용을 보고 선택하거나 복사할 수 있습니다.
- 메모 안의 `http://` 및 `https://` 주소는 바로 열 수 있는 링크로 표시합니다.

## v6.1.2 이중 주소

- GitHub Pages와 Firebase Hosting에서 동일한 화면과 Firestore 데이터를 사용합니다.
- GitHub 주소는 그대로 유지합니다.
- iPhone 홈 화면 앱은 `https://status-board-d2b05.firebaseapp.com/`에서 추가합니다.
- GitHub 주소로 설치한 기존 홈 화면 앱에서 로그인하면 Firebase Hosting 주소로 이동합니다.

## 기존 데이터 안전성

- Firebase 프로젝트 ID `status-board-d2b05`를 유지합니다.
- `categories`, `tasks`, `members` 컬렉션과 기존 문서 ID를 유지합니다.
- 기존 필드 `title`, `status`, `dueDate`, `memo`, `order`, `categoryId`를 그대로 사용합니다.
- `assignee`는 항목을 새로 만들거나 편집할 때만 저장되는 선택 필드입니다.
- 앱 실행이나 GitHub Pages 배포만으로 기존 데이터를 삭제하거나 초기화하지 않습니다.
- 실제 삭제는 권한이 있는 사용자가 삭제 버튼을 누르고 확인한 경우에만 실행됩니다.

## 권한

- 열람: 보기 전용
- 편집: 관리자와 동일하게 카테고리, 항목, 순서, 사용자 권한 관리
- 관리자: `config.js`에 지정된 소유자

## 파일

```text
TDL/
├── assets/
│   ├── app-icon.svg
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── openai-wordmark.png
├── index.html
├── styles.css
├── config.js
├── app.js
├── firestore.rules
├── firebase.json
├── manifest.webmanifest
├── 404.html
├── DATA-SAFETY.md
└── VERSION.txt
```

## Firebase 규칙

v6.1.2는 Hosting 주소 분기만 추가하며 `firestore.rules`는 변경하지 않습니다.
v6.0.1의 편집자 전체 권한 규칙을 이미 게시했다면 Firebase Console에서 다시 갱신할 필요가 없습니다.
