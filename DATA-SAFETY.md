# 기존 데이터 보존 확인

이 패키지는 기존 Firebase 프로젝트 `status-board-d2b05`와 동일한 Firestore 컬렉션을 사용합니다.

- categories
- tasks
- members

페이지 로딩, 로그인, 배포 시 데이터를 지우는 작업은 실행하지 않습니다.
GitHub Pages 파일 교체는 Firestore 데이터베이스와 별개이므로 기존 데이터가 삭제되지 않습니다.

데이터가 삭제되는 동작은 관리자가 화면에서 삭제 버튼을 누르고 확인한 경우에만 실행됩니다.
