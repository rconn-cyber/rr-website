// member-auth.js — Member portal login system

(function () {

  // ── SESSION ──────────────────────────────────────────────────────────────
  const SESSION_KEY = 'rr_member_session';
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
  function setSession(d) { localStorage.setItem(SESSION_KEY, JSON.stringify(d)); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  // ── WAIT FOR TOPBAR THEN UPDATE ──────────────────────────────────────────
  function whenTopbarReady(fn) {
    if (document.getElementById('topbar')) { fn(); return; }
    const obs = new MutationObserver(function() {
      if (document.getElementById('topbar')) { obs.disconnect(); fn(); }
    });
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    // Also try on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function() {
      if (document.getElementById('topbar')) { obs.disconnect(); fn(); }
    });
  }

  // ── ADMIN AUTO-BYPASS ────────────────────────────────────────────────────
  const page = window.location.pathname.split('/').pop() || '';
  const sess = getSession();

  if (sess) {
    const t = sess.admin_type || '';
    if (page === 'admin.html' && (t === 'Full Access' || t === 'Membership')) {
      document.addEventListener('DOMContentLoaded', function () {
        const overlay = document.getElementById('loginOverlay');
        if (overlay) { overlay.classList.add('hidden'); overlay.style.display = 'none'; }
        const main = document.getElementById('adminMain');
        if (main) {
          main.style.display = 'block';
          if (typeof loadMembers === 'function') loadMembers();
        }
      });
    }
    if (page === 'events-admin.html' && (t === 'Full Access' || t === 'Events')) {
      document.addEventListener('DOMContentLoaded', function () {
        const overlay = document.getElementById('loginOverlay');
        if (overlay) { overlay.classList.add('hidden'); overlay.style.display = 'none'; }
        if (typeof initApp === 'function') initApp();
      });
    }
  }

  // ── RESTORE SESSION IN HEADER ────────────────────────────────────────────
  if (sess) {
    whenTopbarReady(function() { updateHeaderForMember(sess); });
  }

  // ── MODAL HTML ────────────────────────────────────────────────────────────
  function injectModal() {
    if (document.getElementById('memberLoginOverlay')) return;
    document.body.insertAdjacentHTML('beforeend', `
<div id="memberLoginOverlay" style="
  display:none;position:fixed;inset:0;
  background:rgba(5,12,25,0.85);
  z-index:2000;align-items:center;justify-content:center;">
  <div style="
    background:#0d1f3c;color:#fff;
    padding:3rem 2.5rem;max-width:480px;width:90%;
    border:1px solid rgba(201,168,76,0.3);position:relative;">
    <button onclick="closeMemberModal()" style="
      position:absolute;top:1rem;right:1rem;
      background:none;border:none;color:#c9a84c;
      font-size:1.4rem;cursor:pointer;line-height:1;">&#10005;</button>
    <h2 style="font-family:'Cinzel Decorative',serif;color:#c9a84c;font-size:1.2rem;margin-bottom:0.3rem;text-align:center;">
      Members: Sign In to Access Your Portal
    </h2>
    <p style="color:#9ca3af;font-size:0.85rem;text-align:center;margin-bottom:2rem;">
      View your membership status, update contact information, access member-only events, and manage your account.
    </p>
    <input id="mlEmail" type="email" placeholder="Email address"
      autocomplete="off"
      style="width:100%;padding:0.8rem;margin-bottom:0.75rem;background:#fff;border:none;font-size:0.95rem;box-sizing:border-box;"
      onkeydown="if(event.key==='Enter')document.getElementById('mlPass').focus()">
    <div style="position:relative;margin-bottom:1rem;">
      <input id="mlPass" type="password" placeholder="Member number (e.g. 1023)"
        autocomplete="new-password"
        style="width:100%;padding:0.8rem;padding-right:2.8rem;background:#fff;border:none;font-size:0.95rem;box-sizing:border-box;"
        onkeydown="if(event.key==='Enter')doMemberLogin()">
      <span onclick="var i=document.getElementById('mlPass');i.type=i.type==='password'?'text':'password';"
        style="position:absolute;right:0.9rem;top:50%;transform:translateY(-50%);cursor:pointer;font-size:1rem;color:#666;user-select:none;">&#128065;</span>
    </div>
    <div id="mlError" style="color:#e74c3c;font-size:0.82rem;margin-bottom:0.75rem;text-align:center;min-height:1.2rem;"></div>
    <div style="display:flex;gap:1rem;">
      <button onclick="doMemberLogin()" style="
        flex:1;background:#c9a84c;color:#0d1f3c;border:none;
        padding:0.85rem;font-family:'Cinzel',serif;font-size:0.8rem;
        letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;font-weight:700;">
        SIGN IN
      </button>
      <a href="https://tamparoughriders.org/membership" target="_blank" style="
        flex:1;display:flex;align-items:center;justify-content:center;
        border:1px solid #c9a84c;color:#c9a84c;
        padding:0.85rem;font-family:'Cinzel',serif;font-size:0.8rem;
        letter-spacing:0.1em;text-transform:uppercase;text-decoration:none;">
        APPLY FOR MEMBERSHIP
      </a>
    </div>
    <p style="color:#6b7280;font-size:0.78rem;text-align:center;margin-top:1.5rem;margin-bottom:0;">
      Member accounts are managed through Wild Apricot.<br>
      <a href="https://tamparoughriders.org/Sys/ResetPasswordRequest" target="_blank"
        style="color:#c9a84c;">Reset Password</a>
    </p>
  </div>
</div>`);
  }

  document.addEventListener('DOMContentLoaded', injectModal);
  if (document.readyState !== 'loading') injectModal();

  // ── PUBLIC FUNCTIONS ─────────────────────────────────────────────────────
  window.openMemberModal = function () {
    injectModal();
    const s = getSession();
    if (s) { toggleMemberMenu(); return; }
    const el = document.getElementById('memberLoginOverlay');
    if (!el) return;
    document.getElementById('mlEmail').value = '';
    document.getElementById('mlPass').value = '';
    document.getElementById('mlError').textContent = '';
    el.style.display = 'flex';
    setTimeout(function() { document.getElementById('mlEmail').focus(); }, 50);
  };

  window.closeMemberModal = function () {
    const el = document.getElementById('memberLoginOverlay');
    if (el) el.style.display = 'none';
  };

  document.addEventListener('click', function (e) {
    const overlay = document.getElementById('memberLoginOverlay');
    if (overlay && e.target === overlay) closeMemberModal();
  });

  window.doMemberLogin = async function () {
    const email    = document.getElementById('mlEmail').value.trim();
    const password = document.getElementById('mlPass').value.trim();
    const errEl    = document.getElementById('mlError');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'Please enter your email and member number.'; return; }
    errEl.textContent = 'Signing in\u2026';
    try {
      const res  = await fetch('/.netlify/functions/member-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok || data.error) { errEl.textContent = data.error || 'Invalid email or member number.'; return; }
      setSession(data);
      closeMemberModal();
      updateHeaderForMember(data);
    } catch (err) {
      errEl.textContent = 'Login failed. Please try again.';
    }
  };

  window.memberLogout = function () {
    clearSession();
    location.reload();
  };

  // ── HEADER STATE ─────────────────────────────────────────────────────────
  function updateHeaderForMember(member) {
    const btn = document.querySelector('#topbar .member-btn');
    if (!btn) { whenTopbarReady(function(){ updateHeaderForMember(member); }); return; }
    const name      = (member.first_name || member.email || 'Member').toUpperCase();
    const adminType = member.admin_type || 'None';
    let adminLink = '';
    if (adminType === 'Full Access' || adminType === 'Membership') {
      adminLink = '<a href="admin.html" style="color:#c9a84c;font-size:0.72rem;font-family:Cinzel,serif;letter-spacing:0.08em;text-decoration:none;white-space:nowrap;">ADMIN</a>';
    } else if (adminType === 'Events') {
      adminLink = '<a href="events-admin.html" style="color:#c9a84c;font-size:0.72rem;font-family:Cinzel,serif;letter-spacing:0.08em;text-decoration:none;white-space:nowrap;">EVENTS</a>';
    }
    btn.outerHTML = '<div id="memberHeaderWrap" style="display:flex;align-items:center;gap:0.75rem;">'
      + adminLink
      + '<div style="position:relative;">'
      + '<button class="member-btn-active" id="memberNameBtn" onclick="toggleMemberMenu()"'
      + ' style="background:#c9a84c;color:#0d1f3c;font-weight:700;border:none;">'
      + '&#9733; ' + name
      + '</button>'
      + '<div id="memberDropdown" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:#0d1f3c;border:1px solid rgba(201,168,76,0.3);min-width:180px;z-index:1500;padding:0.5rem 0;">'
      + '<div style="padding:0.5rem 1.2rem;font-size:0.75rem;color:#9ca3af;border-bottom:1px solid rgba(201,168,76,0.15);margin-bottom:0.25rem;">'
      + (member.first_name || '') + ' ' + (member.last_name || '') + '<br>'
      + '<span style="color:#c9a84c;">#' + (member.member_number || '') + '</span>'
      + '</div>'
      + '<a href="#" onclick="memberLogout();return false;" style="display:block;padding:0.6rem 1.2rem;color:#fff;font-family:Cinzel,serif;font-size:0.7rem;letter-spacing:0.08em;text-decoration:none;text-transform:uppercase;" onmouseover="this.style.color=\'#c9a84c\'" onmouseout="this.style.color=\'#fff\'">Sign Out</a>'
      + '</div>'
      + '</div>'
      + '</div>';
  }

  window.toggleMemberMenu = function () {
    const d = document.getElementById('memberDropdown');
    if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
  };

  document.addEventListener('click', function (e) {
    const d   = document.getElementById('memberDropdown');
    const btn = document.getElementById('memberNameBtn');
    if (d && !d.contains(e.target) && e.target !== btn) d.style.display = 'none';
  });

})();
