# 고카리그 (GOKA LEAGUE) — Claude Code 브리핑

> 상세 명세는 `GokaLeague_System_Specification.md` (Ver 1.4) 참조

---

## 프로젝트 개요

반기별 승강제 골프 동호회 리그 관리 시스템 + 정모(팀 대항전).
**백엔드 없음** — 순수 정적 HTML이 Supabase REST API를 직접 호출.
예외는 사진 AI 판독용 Vercel 서버리스 함수 하나(`api/extract-score.js`)뿐이다.

---

## 핵심 파일

| 파일 | 역할 | 키·인증 |
|------|------|--------|
| `index.html` | 회원용 앱 (리그순위·대회결과·선수카드) | 공개(publishable) 키 |
| `event.html` | 회원용 **정모** 페이지 (스코어집계·최종 종합·개인시상) | 공개 키 |
| `admin/index.html` | 일반대회 관리자 앱 (4단계 워크플로우) | 공개 키 + 관리자 로그인 |
| `admin/event2.html` | **정모 관리자 2 (AI 사진 판독) — 현재 메인** | 공개 키 + 관리자 로그인 |
| `admin/event.html` | 정모 관리자 1 (수동 JSON) — AI가 막힐 때 대체용 | 공개 키 + 관리자 로그인 |
| `admin/auth.js` | 관리자 로그인 공용 모듈 (Supabase Auth) | 공개 키 |
| `api/extract-score.js` | 사진 → JSON 판독 서버리스 함수 (Claude API) | Vercel 환경변수 `ANTHROPIC_API_KEY` |
| `package.json` | `@anthropic-ai/sdk` 의존성 (함수 빌드용) | - |
| `manifest.json` / `manifest-admin.json` | 회원용 / 관리자용 PWA | - |
| `.claude/launch.json` | 로컬 미리보기 서버 (port 3344) | - |

**로컬 경로:** `C:\Users\51\Naver MYBOX\07. Utility App\01. goka-league\`
**GitHub:** `jjwook5/goka-league` (main 브랜치 하나만 유지)
**배포:** Vercel 자동 배포 — 커밋 후 약 30초
**회원 URL:** `golfriend.vercel.app` · **정모:** `/event.html`
**관리자 URL:** `golfriend.vercel.app/admin/` → 헤더 [🏆 정모 관리] → `/admin/event2.html`

---

## 배포 방법

```bash
git add index.html event.html admin/index.html admin/event.html admin/event2.html admin/auth.js api/extract-score.js
git commit -m "설명"
git push origin main
```

- 기능 수정은 **브랜치 → Vercel Preview 검증 → 사용자 승인 후 main 병합** 순서로 한다.
- 브랜치를 새로 만들면 Preview 도메인이 바뀌므로, 관리자 화면 테스트 시 **그 도메인에서 한 번 로그인**이 필요하다.
- `package.json`이 있어 Vercel 빌드에 `npm install` 단계가 있다. 정적 파일 배포는 그대로 동작한다.

---

## DB 테이블 (Supabase PostgreSQL)

| 테이블 | 용도 | PK |
|--------|------|----|
| `tb_member` | 회원 마스터 | `전화번호` |
| `tb_Course` | 코스 마스터 | `(구장명, 코스명)` |
| `tb_Match_Episodes` | 대회 에피소드 | `(대회번호, 코스)` |
| `tb_Record` | 성적 트랜잭션 | `(대회번호, 전화번호)` |
| `tb_Season` | 시즌 마스터 | `시즌ID` |
| `visits` | 방문 기록(MAU) | - |

**tb_Record 주요 필드:** `H1~H18`(오버파), `합계`(그로스), `NP_Handicap`, `Net_Score`, `Luck_Factor`, `전반코스`/`후반코스`, `조번호`, `소속팀`
**tb_Match_Episodes:** `제외홀`, `완료구분`, `니어리스트`(정모용)
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

### 정모 전용 규칙 (event.html · admin/event.html · admin/event2.html)
- **팀 합산 동점:** 각 팀 **1위(가장 잘 친) 선수끼리** 비교 → 같으면 2위끼리 → 3위… (`cmpTeamBestFirst`)
- **스트로크 우승자(메달리스트)는 신페 우승에서 제외** (`npAwardWinners`).
  신페 순위표의 순위는 그대로 두고 **실제 수상자에게만 👑** 표시, 팀 보너스 +10도 실제 수상자 팀으로.
- 팀 점수 = 순위점수(100/90/80/70) + 메달리스트 +10 + 신페 남·여 우승 각 +10 + 니어 +10 + 버디 개당 +5 + 신페 꼴등 −10
- **이글은 버디로 세지 않는다** (버디 = H값 -1만)
- ⚠️ 이 규칙들은 **정모 전용**이다. 일반대회는 신페 우승 시상 자체가 없다.

### 완료구분 3단계
```
진행중 → 마감 → 완료
  ↑관리자만   ↑사용자 공개(스트로크만)   ↑전체 공개
```

### 성명/닉네임 표시 정책
- **항상 tb_member 최신값 우선** (`getMemberInfo()` 헬퍼 사용)
- tb_Record의 성명/닉네임은 스냅샷(과거 기록용)이며 표시에는 미사용

### 게스트 처리 (Ver 1.3)
- 게스트 = `등급='게스트'` + `소속리그=NULL` + 회원번호 `010-9000-XXXX`
- **청백전에만 포함**, 리그순위·신페리오·스트로크·번외·통계에서는 제외
- 등급 선택지: 일반 / 스텝(용도 미정) / 게스트

---

## AI 사진 판독 (Ver 1.4)

```
[관리자 화면] 사진 선택 → 브라우저에서 압축·조각내기
   → GokaAuth.authFetch('/api/extract-score')   (Authorization: 관리자 로그인 토큰)
   → [서버] 토큰·관리자 권한 검증 → Claude(claude-opus-5) 구조화 출력
   → 결과 JSON → 화면 입력표/검증표에 채움 → 사람이 확인 → 💾 저장(기존 저장 함수)
```

- **자동 저장 없음.** 저장은 항상 사람이 버튼을 누른다.
- **판독 결과 JSON 편집칸** 제공 — 이름 오타·숫자 오판독을 JSON에서 고친 뒤 [다시 채우기]. 줄을 복사해 빠진 선수 추가 가능.
- **앱 표시 이름 기억**(정모): 스마트스코어 닉네임이 명단과 다르면 한 번 맞춰 주면 그 기기(localStorage `goka_ev2_alias`)에 기억 → 다음 판독부터 자동 매칭. 목록에서 ✕로 삭제.
- **경고:** 카드 인쇄 합계 불일치(⛔), 명단에 없는 이름, 18홀 아님, 같은 사진에 다른 조 섞임, 조에서 빠진 선수, 저장된 값과 다름, 진행홀 감소(그날 기준)
- **이미지 처리:** 가로 1080px, 세로 긴 캡처는 **겹침 300px로 조각내기**(리더보드). 카톡 등을 거친 축소 사진은 판독률이 떨어진다.
- **오류 코드:** 401=로그인 토큰 문제(이때만), 403=관리자 아님, 400=형식, 413=용량, 429=한도, 502=AI 실패/거절, 503=키 미설정
- **비용:** 스코어카드 1장 ≈ $0.04, 리더보드 1회 ≈ $0.08 (정모 하루 약 $1.5)
- **정확도 실측(2026-09-11):** 스코어카드 504/504칸, 리더보드 28/28명
- 비상용으로 **JSON 붙여넣기 / 표준 프롬프트 복사**를 각 화면에 접어 두었다.

---

## 주요 상태 변수

**index.html (회원용)**
```javascript
DATA = { members, courses, matches, records, seasons }
currentTab, currentLeague, currentSeasonId, currentMatchId
currentResultSubTab, currentTitleSort, currentPlayer, profileNameMode
```

**admin/index.html (일반대회 관리자)**
```javascript
globalData = { members, courses, records, matchEpisodes, seasons }
assignedGroups, currentMatchId, currentVenue, isEditMode
phase4SubTab, phase4TitleSort
aiFileList, aiLast          /* 스코어카드 AI 판독 */
```

**admin/event2.html (정모 관리자 2)**
```javascript
MEMBERS, RECORDS, EPISODES, COURSES, VENUE, STATUS
pending, curTab, aiFiles, aiLast   /* aiLast[1]=리더보드, aiLast[2]=스코어카드 */
```

---

## 주의사항

- **service_role 키는 코드·HTML에 절대 넣지 않는다.** 정적 파일은 누구나 받아볼 수 있다.
  저장소 루트의 파일은 배포되면 `golfriend.vercel.app/<파일명>`으로 그대로 열린다.
  서빙할 이유가 없는 파일(`_archive/` 등)은 `.vercelignore`에 넣는다.
  (2026-09-11 공개 저장소·관리자 페이지로 유출 → 로그인 방식으로 전환, 키 교체)
- **`ANTHROPIC_API_KEY`는 Vercel 환경변수(Production+Preview)에만** 둔다. 코드·커밋·채팅 금지. 등록 후 재배포해야 적용된다.
- 관리자 쓰기 권한 = DB RLS 정책 `goka_admin_all` + 함수 `is_goka_admin()`
  (로그인 토큰의 `app_metadata.role = 'admin'` 인 계정만 쓰기 가능. 이 값은 대시보드/SQL로만 변경 가능)
- **관리자 추가:** ① 대시보드 Authentication → Users → Add user → Create new user (Auto Confirm User 체크)
  ② SQL: `update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'::jsonb where email = '...';`
  ②를 빼먹으면 로그인은 되지만 "관리자 권한이 없는 계정"으로 막힌다. 권한 회수 = Users에서 계정 삭제
- **로그인 유지:** 접속 토큰 1시간 + 갱신 토큰(기본 만료 없음) → 같은 기기는 계속 유지.
  **[로그아웃]은 그 계정의 모든 기기를 로그아웃시킨다.** 같은 브라우저에 관리자 탭을 여러 개 오래 열어 두면 세션이 끊길 수 있다(탭 하나만 쓰기).
- **화면은 캐시(globalData/DATA)를 믿지 말 것.** 대회 선택·코스 매핑·제외홀 확인·정산은 DB에서 다시 읽는다.
  (2026-09-15 조편성 덮어쓰기 시 코스 유실 → 합계 미계산 → 정산 차단 사고의 원인)
- 조편성 덮어쓰기(`submitPhase1`)는 레코드를 지우고 다시 만든다. **코스 매핑은 조별로 물려받지만 홀 스코어는 삭제된다.**
- 한국어 필터값은 `encodeURIComponent()` 필수
- tb_Record 홀 배열: `[H1~H9, H10~H18]` (index 0~8: 전반, 9~17: 후반)
- 수정 후 반드시 커밋 & 푸시해야 Vercel에 반영됨
- 코드 수정 전 항상 해당 파일을 Read로 확인 후 Edit 진행
- DB를 건드리는 검증은 **쓰기 함수를 가로챈 드라이런**으로 한다 (운영 DB 오염 방지)
