/* ════════════════════════════════════════════════════
   POST /api/extract-score — 정모 AI 스코어 판독 (Vercel 함수)
   ────────────────────────────────────────────────────
   · 관리자 로그인 토큰(Supabase, app_metadata.role='admin')을 확인한 뒤에만 AI를 부른다.
   · ANTHROPIC_API_KEY 는 Vercel 환경변수에만 둔다. 코드·로그에 키/토큰/이미지를 남기지 않는다.
   · 401 은 "로그인 토큰 문제"에만 쓴다 (admin/auth.js 가 401을 로그인 만료로 보고 재로그인함).
     Anthropic 쪽 인증 오류는 502, 키 미설정은 503.
   · 판독 결과만 돌려준다. DB 저장은 하지 않는다 (사람이 확인 후 event2.html 에서 저장).
   ════════════════════════════════════════════════════ */
import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 300 };

const SUPABASE_URL = 'https://ogyzzmlxxmplwaawraoc.supabase.co';
const SUPABASE_PUBLISHABLE = 'sb_publishable_4lEKf_VDXf7udBOGh-Bggw_ee4UApQd';   /* 공개 키 — 토큰 확인용 */
const MODEL = 'claude-opus-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_EFFORT = 'high';
const MAX_IMAGES = 10;                 /* 긴 리더보드 캡처는 브라우저에서 조각내므로 여유 있게 */
const MAX_TOTAL_CHARS = 4_300_000;     /* Vercel 요청 본문 한도(4.5MB) 안쪽 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/* ── 출력 스키마 (구조화 출력) ── */
const nullableInt = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const nullableStr = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

const SCHEMAS = {
  leaderboard: obj({
    players: {
      type: 'array',
      items: obj({ name: { type: 'string' }, shown_name: { type: 'string' }, over: { type: 'integer' }, holes: nullableInt })
    },
    unreadable: { type: 'array', items: { type: 'string' } }
  }),
  scorecard: obj({
    players: {
      type: 'array',
      items: obj({
        name: { type: 'string' },
        shown_name: { type: 'string' },
        image: { type: 'integer' },
        course_label: nullableStr,
        scores: { type: 'array', items: { type: 'integer' } },
        front_total: nullableInt,
        back_total: nullableInt,
        total: nullableInt
      })
    },
    unreadable: { type: 'array', items: { type: 'string' } }
  })
};

/* ── 프롬프트 (admin/event.html 의 LEADER_PROMPT / SCORE_PROMPT 규칙에서 출발) ── */
const SYSTEM = `너는 골프 스코어 앱(스마트스코어) 캡처 화면의 숫자를 그대로 옮겨 적는 판독기다.
결과는 관리자가 눈으로 확인한 뒤 저장한다. 틀린 숫자를 지어내는 것이 빈칸보다 훨씬 해롭다.
화면에 보이는 것만 적고, 흐리거나 가려져서 확신이 없는 선수는 players 에 넣지 말고 unreadable 에 "이름: 이유" 로 적어라.`;

const NAME_RULE = `[이름 규칙]
- shown_name = 화면에 적힌 이름 그대로.
- name = 아래 [명단]에서 같은 사람이면 명단의 "성명". 화면에는 닉네임으로 나오거나, 글자 사이에 숫자·기호가 끼어 있거나, 한 글자가 다르게 보일 수 있다. 명단과 조·점수 등을 함께 보고 명백히 같은 사람일 때만 명단 성명으로 바꿔라.
- 명단에서 찾을 수 없으면 name 도 화면 표기 그대로 둔다.`;

const LEADER_RULES = `리더보드 캡처를 보고 선수별 현재 오버파를 뽑아라.

[규칙]
1. over = SCORE 열의 오버파 누계 정수. "E"·"이븐"·"0"은 0, 언더는 음수(-2), "+7"은 7. 맨 앞 RANK(순위) 열과 헷갈리지 마라.
2. holes = HOLE(진행홀) 열의 정수. "F"·"완료"는 18. 진행홀 표기가 없으면 null.
3. 사진이 여러 장이면 한 긴 캡처를 위에서부터 자른 조각이거나 여러 번 찍은 캡처다. 조각끼리 겹치는 줄이 있으니 한 선수는 한 번만 적어라.
   같은 선수가 서로 다른 값으로 나오면 진행홀이 더 많은 쪽을 써라.
4. 줄 하나라도 이름·점수를 확신할 수 없으면 추측하지 말고 unreadable 에 적어라.`;

const SCORE_RULES = `조별 스코어카드 캡처를 보고 선수별 18홀 오버파를 뽑아라. 보통 사진 한 장 = 한 조(4명).

[카드 구조]
- 코스 표기 줄(예 "남-서" = 전반 남, 후반 서), 그 아래 위 표(전반 9홀)와 아래 표(후반 9홀).
- 각 표: HOLE 1~9, PAR 줄, 선수별 줄, 마지막 T 열(그 9홀의 타수 합계).
- 카드 맨 위에 선수별 총타수 요약이 있을 수 있다(옆으로 밀려 일부만 보일 수 있음).

[규칙]
1. image = 그 선수가 나온 사진 번호(1부터).
2. scores = 위 표 9칸 + 아래 표 9칸, 정확히 18개. 플레이 순서 그대로(위 표 1→9, 아래 표 1→9).
3. 칸 표기는 보통 오버파다: 파 0, 보기 1, 더블 2 …, 버디 -1, 이글 -2. 버디·이글은 나비 같은 그림 위에 숫자가 겹쳐 있으니 그림 속 숫자를 읽어라.
   스스로 검산하라: 오버파 표기라면 T = PAR 합 + 9칸 합. 칸이 실제 타수(3,4,5 …)라면 T = 9칸 합이고, 이때는 각 칸에서 그 홀 PAR 를 빼서 오버파로 바꿔라.
4. front_total / back_total = 위 표 / 아래 표의 T 열 숫자 그대로(타수). 없으면 null.
5. total = 카드 맨 위 요약에 보이는 그 선수의 총타수. 안 보이면 null.
6. course_label = 카드의 코스 표기 그대로(예 "남-서"). 없으면 null.
7. 한 선수의 18칸 중 한 칸이라도 확신이 없으면 그 선수는 players 에서 빼고 unreadable 에 "이름: 몇 번 홀이 불확실" 처럼 적어라.`;

function rosterText(roster) {
  if (!roster.length) return '[명단]\n(없음)';
  return '[명단] 성명 | 닉네임 | 조 | 전반/후반 코스\n' +
    roster.map(r => `${r.name} | ${r.nick || '-'} | ${r.group || '-'} | ${r.front || '-'}/${r.back || '-'}`).join('\n');
}
function parsText(pars) {
  const lines = Object.entries(pars).map(([c, p]) => `${c}: ${p.join(',')}`);
  return lines.length ? '[코스별 PAR (1~9번 홀)]\n' + lines.join('\n') : '';
}

/* ── 유틸 ── */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const cleanStr = (v, max = 30) => String(v == null ? '' : v).replace(/[\r\n|]/g, ' ').trim().slice(0, max);

async function requireAdmin(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, '로그인 토큰이 없습니다.');
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE, Authorization: `Bearer ${m[1]}` }
    });
  } catch (e) {
    throw new HttpError(502, '로그인 확인 서버에 연결하지 못했습니다.');
  }
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new HttpError(401, '로그인이 만료되었거나 올바르지 않습니다.');
  if (!r.ok) throw new HttpError(502, `로그인 확인 실패 (Supabase ${r.status})`);
  const user = await r.json().catch(() => null);
  if (!user || !user.app_metadata || user.app_metadata.role !== 'admin') throw new HttpError(403, '관리자 권한이 없는 계정입니다.');
}

function parseBody(req) {
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch (e) { throw new HttpError(400, '요청 본문이 JSON 형식이 아닙니다.'); }
  if (!body || typeof body !== 'object') throw new HttpError(400, '요청 본문이 비어 있습니다.');

  const mode = body.mode;
  if (mode !== 'leaderboard' && mode !== 'scorecard') throw new HttpError(400, 'mode 는 leaderboard 또는 scorecard 여야 합니다.');

  const imgs = body.images;
  if (!Array.isArray(imgs) || imgs.length < 1) throw new HttpError(400, '사진이 없습니다.');
  if (imgs.length > MAX_IMAGES) throw new HttpError(413, `사진은 한 번에 ${MAX_IMAGES}장(조각)까지입니다.`);
  let total = 0;
  const images = imgs.map((s, i) => {
    const mm = IMAGE_RE.exec(typeof s === 'string' ? s : '');
    if (!mm) throw new HttpError(400, `${i + 1}번 사진 형식이 올바르지 않습니다 (data:image/...;base64).`);
    total += mm[2].length;
    if (mm[2].length * 0.75 > MAX_IMAGE_BYTES) throw new HttpError(413, `${i + 1}번 사진이 너무 큽니다 (5MB 초과).`);
    return { media_type: mm[1], data: mm[2] };
  });
  if (total > MAX_TOTAL_CHARS) throw new HttpError(413, '사진 용량 합계가 너무 큽니다. 장수를 줄여 주세요.');

  const roster = (Array.isArray(body.roster) ? body.roster : []).slice(0, 80).map(r => ({
    name: cleanStr(r && r.name), nick: cleanStr(r && r.nick), group: cleanStr(r && r.group),
    front: cleanStr(r && r.front), back: cleanStr(r && r.back)
  })).filter(r => r.name);

  const pars = {};
  if (body.pars && typeof body.pars === 'object') {
    Object.entries(body.pars).slice(0, 12).forEach(([k, v]) => {
      if (Array.isArray(v) && v.length === 9 && v.every(n => Number.isInteger(n) && n >= 3 && n <= 6)) pars[cleanStr(k)] = v;
    });
  }

  const effort = EFFORTS.includes(body.effort) ? body.effort : DEFAULT_EFFORT;
  return { mode, images, roster, pars, effort };
}

/* 판독 결과 형식 점검 → 경고 목록 (값은 고치지 않는다. 판단은 사람이) */
function checkResult(mode, data, imageCount) {
  const warnings = [];
  const players = Array.isArray(data.players) ? data.players : [];
  if (!players.length) warnings.push('사진에서 선수를 한 명도 읽지 못했습니다.');
  if (mode === 'scorecard') {
    players.forEach(p => {
      if (!Array.isArray(p.scores) || p.scores.length !== 18) warnings.push(`${p.name}: 18홀이 아니라 ${Array.isArray(p.scores) ? p.scores.length : 0}개를 읽었습니다.`);
      if (!(p.image >= 1 && p.image <= imageCount)) p.image = null;
    });
  }
  return { players, unreadable: Array.isArray(data.unreadable) ? data.unreadable : [], warnings };
}

/* Anthropic SDK 오류 → 우리 규칙의 상태코드 (절대 401 로 내보내지 않는다) */
function mapAnthropicError(e) {
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, 'AI 호출 한도에 걸렸습니다. 1분쯤 뒤 다시 실행하세요.');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new HttpError(502, 'AI 키가 거절되었습니다. Vercel 환경변수 ANTHROPIC_API_KEY 를 확인하세요.');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new HttpError(502, 'AI 응답 시간이 초과되었습니다. 사진 수를 줄여 다시 실행하세요.');
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(502, 'AI 서버에 연결하지 못했습니다.');
  if (e instanceof Anthropic.BadRequestError) return new HttpError(502, 'AI 요청이 거절되었습니다: ' + String(e.message || '').slice(0, 200));
  if (e instanceof Anthropic.APIError) return new HttpError(502, `AI 서버 오류 (${e.status || '?'}) — 잠시 뒤 다시 실행하세요.`);
  return null;
}

export default async function handler(req, res) {
  const t0 = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'POST 만 허용됩니다.'); }

    await requireAdmin(req);                                   /* ← 이 줄을 통과해야 AI 호출 */
    const { mode, images, roster, pars, effort } = parseBody(req);
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new HttpError(503, 'ANTHROPIC_API_KEY 가 설정되지 않았습니다. Vercel → Settings → Environment Variables 에 등록 후 재배포하세요.');
    }

    const content = [];
    images.forEach((img, i) => {
      content.push({ type: 'text', text: `사진 ${i + 1}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
    });
    content.push({
      type: 'text',
      text: [mode === 'leaderboard' ? LEADER_RULES : SCORE_RULES, NAME_RULE, rosterText(roster), mode === 'scorecard' ? parsText(pars) : '']
        .filter(Boolean).join('\n\n')
    });

    const client = new Anthropic({ timeout: 240_000, maxRetries: 1 });
    let msg;
    try {
      msg = await client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        output_config: { effort, format: { type: 'json_schema', schema: SCHEMAS[mode] } },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',                                  /* Opus 5 가 드물게 거절하면 서버가 다른 모델로 재시도 */
        system: SYSTEM,
        messages: [{ role: 'user', content }]
      }).finalMessage();
    } catch (e) {
      throw mapAnthropicError(e) || e;
    }

    if (msg.stop_reason === 'refusal') throw new HttpError(502, 'AI가 이 사진의 판독을 거절했습니다. JSON 붙여넣기(비상용)로 입력하세요.');
    if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'AI 답변이 중간에 끊겼습니다. 사진 수를 줄여 다시 실행하세요.');

    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new HttpError(502, 'AI 답변을 해석하지 못했습니다. 다시 실행하세요.'); }

    const out = checkResult(mode, data, images.length);
    const u = msg.usage || {};
    const fallback = (u.iterations || []).some(it => it.type === 'fallback_message') || msg.content.some(b => b.type === 'fallback');
    res.status(200).json({
      mode,
      players: out.players,
      unreadable: out.unreadable,
      warnings: out.warnings,
      model: msg.model,
      fallback,
      effort,
      ms: Date.now() - t0,
      usage: {
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        cache_read_input_tokens: u.cache_read_input_tokens || 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens || 0
      }
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    /* 로그에는 상태·오류 종류만 (이미지·토큰·키 금지) */
    console.error(`[extract-score] ${status} ${e && e.name} ${status === 500 ? String(e && e.message).slice(0, 200) : ''}`);
    res.status(status).json({ error: status === 500 ? '서버 오류가 발생했습니다.' : e.message, status });
  }
}
