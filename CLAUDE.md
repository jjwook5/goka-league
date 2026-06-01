# 고카리그 (GOKA LEAGUE) — Claude Code 브리핑

> 상세 명세는 `GokaLeague_System_Specification.md` (Ver 1.2) 참조

---

## 프로젝트 개요

반기별 승강제 골프 동호회 리그 관리 시스템.  
**백엔드 없음** — 순수 정적 HTML이 Supabase REST API를 직접 호출.

---

## 핵심 파일

| 파일 | 역할 | API 키 |
|------|------|--------|
| `index.html` | 회원용 앱 (사용자 화면) | SUPABASE_ANON_KEY |
| `admin/index.html` | 관리자용 앱 | SUPABASE_SERVICE_ROLE_KEY |
| `manifest.json` | 회원용 PWA | - |
| `manifest-admin.json` | 관리자용 PWA | - |
| `.claude/launch.json` | 로컬 미리보기 서버 (port 3344) | - |

**로컬 경로:** `C:\Users\51\Naver MYBOX\07. Utility App\01. goka-league\`  
**GitHub:** `jjwook5/goka-league` (main 브랜치)  
**배포:** Vercel 자동 배포 — 커밋 후 약 30초  
**회원 URL:** `golfriend.vercel.app`  
**관리자 URL:** `golfriend.vercel.app/admin/`

---

## 배포 방법

```bash
git add index.html admin/index.html
git commit -m "설명"
git push origin main
```

---

## DB 테이블 (Supabase PostgreSQL)

| 테이블 | 용도 | PK |
|--------|------|----|
| `tb_member` | 회원 마스터 | `전화번호` |
| `tb_Course` | 코스 마스터 | `(구장명, 코스명)` |
| `tb_Match_Episodes` | 대회 에피소드 | `(대회번호, 코스)` |
| `tb_Record` | 성적 트랜잭션 | `(대회번호, 전화번호)` |
| `tb_Season` | 시즌 마스터 | `시즌ID` |

**tb_Record 주요 필드:** `H1~H18`(오버파), `합계`(그로스), `NP_Handicap`, `Net_Score`, `Luck_Factor`  
**스코어 표기:** 오버파 방식 — 버디=-1, 파=0, 보기=1, 더블=2

---

## 핵심 비즈니스 규칙

### 신페리오 NP 계산 (스마트스코어 기준)
```
overParSelected = 추첨된 12개 홀 실제 오버파 합산 (버디=-1 그대로, 캡 없음)
NP_Handicap     = round(overParSelected × 1.5 × 0.8, 2)
합계(Gross)     = 코스기준타 합산 + 18홀 오버파 합산
Net_Score       = round(합계 - NP_Handicap, 2)
Luck_Factor     = round(NP_Handicap - (합계 - 기준타) × 0.8, 2)
```

### 동점자 처리
| 화면 | 1차 | 2차 | 3차 |
|------|-----|-----|-----|
| 신페리오 | Net_Score 낮은 순 | 합산 **높은** 순(재미) | 백카운트 |
| 스트로크 | 합산 낮은 순 | 백카운트 | - |
| 리그순위 | 평균타수 낮은 순 | 참가횟수 많은 순 | 최근대회 성적 낮은 순 |

**백카운트:** 후반9홀(H10~H18) → 8홀(H11~) → ... → H18 단독, 합계가 달라질 때까지 비교

### 완료구분 3단계
```
진행중 → 마감 → 완료
  ↑관리자만   ↑사용자 공개(스트로크만)   ↑전체 공개
```

### 성명/닉네임 표시 정책
- **항상 tb_member 최신값 우선** (`getMemberInfo()` 헬퍼 사용)
- tb_Record의 성명/닉네임은 스냅샷(과거 기록용)이며 표시에는 미사용

---

## 주요 상태 변수

**index.html (회원용)**
```javascript
DATA = { members, courses, matches, records, seasons }
currentTab, currentLeague, currentSeasonId, currentMatchId
currentResultSubTab, currentTitleSort, currentPlayer, profileNameMode
```

**admin/index.html (관리자용)**
```javascript
globalData = { members, courses, records, matchEpisodes, seasons }
assignedGroups, currentMatchId, currentVenue, isEditMode
phase4SubTab, phase4TitleSort
```

---

## 주의사항

- `SERVICE_ROLE_KEY`는 admin/index.html에만 사용 — 절대 외부 노출 금지
- 한국어 필터값은 `encodeURIComponent()` 필수
- tb_Record.scores 배열: `[H1~H9, H10~H18]` (index 0~8: 전반, 9~17: 후반)
- 수정 후 반드시 커밋 & 푸시해야 Vercel에 반영됨
- 코드 수정 전 항상 해당 파일을 Read로 확인 후 Edit 진행
