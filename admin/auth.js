/* ════════════════════════════════════════════════════
   고카 관리자 로그인 (Supabase Auth) — admin/index.html · admin/event.html 공용
   ────────────────────────────────────────────────────
   · 코드에는 공개(publishable) 키만 둔다. secret / service_role 키는 절대 넣지 않는다.
     공개 키는 apikey 헤더에만, Authorization 에는 로그인 토큰(JWT)만 싣는다.
   · 쓰기 권한은 DB의 RLS 정책이 결정한다: public.is_goka_admin()
       = 로그인 토큰의 app_metadata.role 이 'admin' 인 계정만 쓰기 가능
     (app_metadata 는 대시보드/SQL로만 바뀌고 사용자가 스스로 못 바꾼다)
   · 세션은 같은 사이트의 localStorage 를 공유 → 두 관리자 페이지를 오가도 재로그인 없음
   ════════════════════════════════════════════════════ */
const GokaAuth = (() => {
  const SB   = 'https://ogyzzmlxxmplwaawraoc.supabase.co';
  const ANON = 'sb_publishable_4lEKf_VDXf7udBOGh-Bggw_ee4UApQd';   /* 공개(publishable) 키 */
  const STORE = 'goka_admin_session';

  let s = null;              /* { access_token, refresh_token, expires_at, email, role } */
  let refreshing = null;     /* 동시에 여러 요청이 만료돼도 갱신은 한 번만 */
  let loginPending = null;   /* 로그인 창은 한 번만 */

  try { s = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { s = null; }

  function save(d) {
    const u = d.user || {};
    s = {
      access_token:  d.access_token,
      refresh_token: d.refresh_token,
      expires_at:    d.expires_at || (Math.floor(Date.now() / 1000) + (d.expires_in || 3600)),
      email:         u.email || (s && s.email) || '',
      role:          (u.app_metadata && u.app_metadata.role) || ''
    };
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* 저장 불가 환경: 메모리 세션만 */ }
  }
  function clear() {
    s = null;
    try { localStorage.removeItem(STORE); } catch (e) {}
    const b = document.getElementById('gl-badge');   /* 만료된 계정 표시가 남지 않게 */
    if (b) b.remove();
  }

  async function tokenRequest(grant, body) {
    const r = await fetch(`${SB}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(d.error_description || d.msg || d.message || ('HTTP ' + r.status));
      e.status = r.status; e.code = d.error_code || d.error || '';
      throw e;
    }
    return d;
  }

  function refresh() {
    if (!s || !s.refresh_token) return Promise.reject(new Error('세션 없음'));
    if (!refreshing) {
      refreshing = tokenRequest('refresh_token', { refresh_token: s.refresh_token })
        .then(d => { save(d); return s; })
        .catch(e => { clear(); throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  const fresh = () => !!(s && s.access_token && s.expires_at - 60 > Date.now() / 1000);

  /* 유효한 관리자 세션을 돌려준다 (만료됐으면 갱신). 없으면 null */
  async function validSession() {
    if (!fresh()) {
      if (!(s && s.refresh_token)) return null;
      try { await refresh(); } catch (e) { return null; }
    }
    return s.role === 'admin' ? s : null;
  }

  function friendly(e) {
    const m = (e.code || '') + ' ' + (e.message || '');
    if (e.code === 'not_admin') return e.message;
    if (/invalid_credentials|invalid login/i.test(m)) return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (/email_not_confirmed|not confirmed/i.test(m)) return '이메일 인증이 안 된 계정입니다. 대시보드에서 "Auto Confirm User"로 다시 만들어 주세요.';
    if (e.status === 429 || /rate/i.test(m)) return '시도가 너무 많습니다. 잠시 후 다시 시도하세요.';
    return '로그인 실패: ' + (e.message || '알 수 없는 오류');
  }

  function injectStyle() {
    if (document.getElementById('gl-style')) return;
    const st = document.createElement('style');
    st.id = 'gl-style';
    st.textContent = `
      #goka-login { position:fixed; inset:0; z-index:10000; background:#0a1f14; display:flex; align-items:center; justify-content:center; padding:20px;
                    font-family:'Apple SD Gothic Neo','Noto Sans KR',-apple-system,sans-serif; }
      #goka-login .gl-box { width:100%; max-width:340px; background:#12321f; border:1px solid #1e3a2a; border-radius:14px; padding:24px 20px; }
      #goka-login h2 { color:#e8d5a3; font-size:18px; font-weight:800; margin:0 0 4px; text-align:center; }
      #goka-login .gl-sub { color:#6b8f77; font-size:11px; text-align:center; margin-bottom:18px; }
      #goka-login label { display:block; color:#8faa97; font-size:11px; font-weight:700; margin:10px 0 5px; }
      #goka-login input { width:100%; box-sizing:border-box; background:#0d2717; border:1px solid #1e3a2a; border-radius:8px; color:#e8f0ea;
                          font-size:15px; padding:11px 12px; outline:none; font-family:inherit; }
      #goka-login input:focus { border-color:#3d7a52; }
      #goka-login button { width:100%; margin-top:16px; border:none; border-radius:9px; padding:12px; font-size:14px; font-weight:800;
                           background:#2d5a3d; color:#e8d5a3; cursor:pointer; font-family:inherit; }
      #goka-login button:disabled { opacity:.5; cursor:wait; }
      #goka-login .gl-err { color:#f0a0a0; font-size:12px; min-height:18px; margin-top:10px; text-align:center; line-height:1.5; }
      #gl-badge { position:fixed; left:8px; bottom:8px; z-index:9000; background:rgba(13,39,23,.92); border:1px solid #1e3a2a; border-radius:999px;
                  padding:5px 10px; font-size:10px; color:#8faa97; }
      #gl-badge a { color:#e8d5a3; text-decoration:none; margin-left:6px; font-weight:700; cursor:pointer; }
    `;
    document.head.appendChild(st);
  }

  function mountBadge() {
    if (!s) return;
    const old = document.getElementById('gl-badge');
    if (old) { old.querySelector('span').textContent = s.email; return; }
    const b = document.createElement('div');
    b.id = 'gl-badge';
    b.innerHTML = '👤 <span></span><a>로그아웃</a>';
    b.querySelector('span').textContent = s.email;
    b.querySelector('a').onclick = logout;
    document.body.appendChild(b);
  }

  function showLogin(msg) {
    if (loginPending) return loginPending;
    injectStyle();
    loginPending = new Promise(resolve => {
      const ov = document.createElement('div');
      ov.id = 'goka-login';
      ov.innerHTML = `
        <form class="gl-box" autocomplete="on">
          <h2>⚙️ 고카 관리자</h2>
          <div class="gl-sub">관리자 계정으로 로그인하세요</div>
          <label for="gl-email">이메일</label>
          <input id="gl-email" name="email" type="email" autocomplete="username" required>
          <label for="gl-pw">비밀번호</label>
          <input id="gl-pw" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">로그인</button>
          <div class="gl-err"></div>
        </form>`;
      document.body.appendChild(ov);
      const f = ov.querySelector('form'), btn = ov.querySelector('button'), err = ov.querySelector('.gl-err');
      if (msg) err.textContent = msg;
      f.onsubmit = async ev => {
        ev.preventDefault();
        btn.disabled = true; btn.textContent = '확인 중…'; err.textContent = '';
        try {
          const d = await tokenRequest('password', { email: f.email.value.trim(), password: f.password.value });
          const role = d.user && d.user.app_metadata && d.user.app_metadata.role;
          if (role !== 'admin') {
            throw Object.assign(new Error('관리자 권한이 없는 계정입니다. (app_metadata.role = admin 필요)'), { code: 'not_admin' });
          }
          save(d);
          ov.remove(); loginPending = null;
          mountBadge();
          resolve(s);
        } catch (e) {
          err.textContent = friendly(e);
          btn.disabled = false; btn.textContent = '로그인';
          f.password.value = ''; f.password.focus();
        }
      };
      setTimeout(() => (f.email.value ? f.password : f.email).focus(), 30);
    });
    return loginPending;
  }

  /* 페이지 시작 시: 관리자 세션이 확보될 때까지 대기 (없으면 로그인 창) */
  async function require() {
    const ok = await validSession();
    if (ok) { injectStyle(); mountBadge(); return ok; }
    clear();
    return showLogin();
  }

  /* REST 호출 — 토큰을 붙이고, 만료(401)면 한 번 갱신 후 재시도 */
  async function authFetch(url, opts = {}) {
    if (!(await validSession())) { clear(); await showLogin('로그인이 만료되었습니다. 다시 로그인하세요.'); }
    const send = () => {
      const h = { apikey: ANON, Authorization: 'Bearer ' + s.access_token };
      if (opts.write) { h['Content-Type'] = 'application/json'; h['Prefer'] = 'return=minimal'; }
      return fetch(url, { method: opts.method || 'GET', headers: h, body: opts.body });
    };
    let r = await send();
    if (r.status === 401) {
      try { await refresh(); }
      catch (e) { await showLogin('로그인이 만료되었습니다. 다시 로그인하세요.'); }
      r = await send();
    }
    return r;
  }

  async function logout() {
    if (!confirm('로그아웃하시겠습니까?')) return;
    try {
      if (s && s.access_token) {
        await fetch(`${SB}/auth/v1/logout`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + s.access_token } });
      }
    } catch (e) { /* 서버 로그아웃 실패해도 로컬 세션은 지운다 */ }
    clear();
    location.reload();
  }

  return { require, authFetch, logout };
})();
