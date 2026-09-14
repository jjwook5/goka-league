# goka-league

고카리그 관리 시스템 — 반기별 승강제 골프 동호회 리그 + 정모(팀 대항전)

정적 HTML + Supabase REST API 구성이며, 스코어카드·리더보드 **사진 AI 판독**만 Vercel 서버리스 함수를 사용합니다.

| 구분 | 주소 |
|------|------|
| 회원 앱 | https://golfriend.vercel.app |
| 정모 (회원) | https://golfriend.vercel.app/event.html |
| 관리자 | https://golfriend.vercel.app/admin/ |
| 정모 관리자 (AI) | https://golfriend.vercel.app/admin/event2.html |

## 문서

- `CLAUDE.md` — 개발 브리핑 (파일 구조, 규칙, 주의사항)
- `GokaLeague_System_Specification.md` — 시스템 개발 명세서 (Ver 1.4)
- `정모_관리자2_AI자동입력_설계서.md` — 사진 AI 판독 설계서 (구현 완료)
- `운영가이드_골프장스코어_복원절차.md` — 골프장 제공 스코어로 정산 복원
