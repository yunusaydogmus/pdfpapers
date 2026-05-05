/* ============================================
   PDFPAPERS — Authentification (localStorage)
   Aucun backend requis
   ============================================ */

const Auth = (() => {
  'use strict';

  const STORAGE_USER = 'pp_user';
  const STORAGE_USERS = 'pp_users';

  /* ── Stockage ── */
  const loadUser  = () => { try { return JSON.parse(localStorage.getItem(STORAGE_USER)); } catch { return null; } };
  const loadUsers = () => { try { return JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]'); } catch { return []; } };
  const persist   = (user) => { user ? localStorage.setItem(STORAGE_USER, JSON.stringify(user)) : localStorage.removeItem(STORAGE_USER); };

  /* ── CSS injecté ── */
  const CSS = `
    /* Overlay */
    .auth-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.52);z-index:9000;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(5px)}
    .auth-overlay.open{display:flex}
    /* Box */
    .auth-box{background:#fff;border-radius:20px;padding:36px 40px;width:100%;max-width:420px;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.22);animation:authIn .28s cubic-bezier(.34,1.56,.64,1)}
    @keyframes authIn{from{transform:scale(.85) translateY(16px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
    /* Close */
    .auth-close{position:absolute;top:14px;right:14px;width:32px;height:32px;border-radius:8px;background:var(--gray-100);color:var(--gray-500);display:flex;align-items:center;justify-content:center;cursor:pointer;border:none;transition:all .2s;font-size:18px;line-height:1}
    .auth-close:hover{background:var(--gray-200);color:var(--gray-800)}
    /* Tabs */
    .auth-tabs{display:flex;background:var(--gray-100);border-radius:10px;padding:4px;margin-bottom:24px;gap:4px}
    .auth-tab{flex:1;padding:9px;border-radius:8px;border:none;background:transparent;font-size:13px;font-weight:600;color:var(--gray-500);cursor:pointer;transition:all .2s;font-family:inherit}
    .auth-tab.active{background:#fff;color:var(--gray-900);box-shadow:0 1px 4px rgba(0,0,0,.1)}
    /* Form */
    .auth-logo{text-align:center;margin-bottom:20px}
    .auth-logo-icon{width:44px;height:44px;background:var(--primary);border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;margin:0 auto 10px;font-size:20px}
    .auth-logo h2{font-size:20px;font-weight:800;color:var(--gray-900);margin-bottom:3px}
    .auth-logo p{font-size:13px;color:var(--gray-400)}
    .auth-form{display:flex;flex-direction:column;gap:14px}
    .auth-form.hidden{display:none}
    .auth-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .auth-group{display:flex;flex-direction:column;gap:5px}
    .auth-label{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:700;color:var(--gray-600);text-transform:uppercase;letter-spacing:.4px}
    .auth-forgot{font-size:12px;font-weight:500;color:var(--primary);text-transform:none;letter-spacing:0}
    .auth-forgot:hover{text-decoration:underline}
    .auth-wrap{position:relative}
    .auth-input{width:100%;padding:11px 14px;border:1.5px solid var(--gray-200);border-radius:10px;font-size:14px;font-family:inherit;color:var(--gray-900);outline:none;transition:all .2s;background:#fff}
    .auth-input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(22,163,74,.12)}
    .auth-input.err{border-color:#DC2626;box-shadow:0 0 0 3px rgba(220,38,38,.1)}
    .auth-eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:15px;padding:4px;color:var(--gray-400);line-height:1}
    /* Strength */
    .auth-strength{display:none;align-items:center;gap:8px;margin-top:4px}
    .strength-track{flex:1;height:4px;background:var(--gray-200);border-radius:99px;overflow:hidden}
    .strength-bar{height:100%;border-radius:99px;transition:all .3s;width:0}
    .strength-lbl{font-size:11px;font-weight:700;white-space:nowrap}
    /* Error msg */
    .auth-err-msg{background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:9px 13px;font-size:13px;color:#DC2626;font-weight:500;display:none}
    /* Divider */
    .auth-divider{display:flex;align-items:center;gap:10px;color:var(--gray-300);font-size:12px}
    .auth-divider::before,.auth-divider::after{content:'';flex:1;height:1px;background:var(--gray-200)}
    /* Switch */
    .auth-switch{text-align:center;font-size:13px;color:var(--gray-500)}
    .auth-switch a{color:var(--primary);font-weight:600}
    .auth-switch a:hover{text-decoration:underline}
    /* ── User Menu ── */
    .user-menu{position:relative}
    .user-btn{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 5px;border-radius:99px;border:1.5px solid var(--gray-200);background:#fff;cursor:pointer;font-family:inherit;transition:all .2s}
    .user-btn:hover{border-color:var(--primary);background:var(--primary-bg)}
    .user-ava{width:30px;height:30px;background:var(--primary);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0}
    .user-ava-lg{width:44px;height:44px;font-size:16px;background:var(--primary);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0}
    .user-btn-name{font-size:13px;font-weight:600;color:var(--gray-700)}
    .user-drop{display:none;position:absolute;top:calc(100% + 8px);right:0;background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.15);border:1px solid var(--gray-100);min-width:240px;z-index:500;overflow:hidden;animation:dropIn .2s ease}
    .user-drop.open{display:block}
    @keyframes dropIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
    .user-drop-head{display:flex;align-items:center;gap:12px;padding:16px;background:var(--gray-50)}
    .user-drop-div{height:1px;background:var(--gray-100)}
    .user-drop-item{display:flex;align-items:center;gap:10px;padding:12px 16px;font-size:14px;font-weight:500;color:var(--gray-700);text-decoration:none;transition:all .15s;cursor:pointer;border:none;background:none;font-family:inherit;width:100%;text-align:left}
    .user-drop-item:hover{background:var(--gray-50);color:var(--primary)}
    .user-drop-item.danger{border-top:1px solid var(--gray-100);color:#DC2626}
    .user-drop-item.danger:hover{background:#FEF2F2;color:#DC2626}
    @media(max-width:480px){.auth-box{padding:28px 20px}.auth-row{grid-template-columns:1fr}}
  `;

  /* ── HTML du Modal ── */
  const MODAL_HTML = `
  <div id="auth-overlay" class="auth-overlay" role="dialog" aria-modal="true" aria-label="Connexion">
    <div class="auth-box">
      <button class="auth-close" id="auth-close-btn" aria-label="Fermer">✕</button>

      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="login">Se connecter</button>
        <button class="auth-tab" data-tab="register">Créer un compte</button>
      </div>

      <!-- LOGIN -->
      <form id="form-login" class="auth-form" novalidate>
        <div class="auth-logo">
          <div class="auth-logo-icon">📄</div>
          <h2>Bon retour !</h2>
          <p>Connectez-vous à votre compte PDFPapers</p>
        </div>
        <div class="auth-group">
          <label class="auth-label" for="l-email">Email</label>
          <input class="auth-input" type="email" id="l-email" placeholder="vous@exemple.com" autocomplete="email" required />
        </div>
        <div class="auth-group">
          <label class="auth-label" for="l-pwd">
            Mot de passe
            <a class="auth-forgot" href="#" onclick="return false">Oublié ?</a>
          </label>
          <div class="auth-wrap">
            <input class="auth-input" type="password" id="l-pwd" placeholder="••••••••" autocomplete="current-password" required />
            <button type="button" class="auth-eye" data-t="l-pwd">👁</button>
          </div>
        </div>
        <div id="login-err" class="auth-err-msg"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px" id="btn-login">Se connecter</button>
        <div class="auth-divider"><span>ou</span></div>
        <p class="auth-switch">Pas de compte ? <a href="#" data-tab="register">S'inscrire gratuitement</a></p>
      </form>

      <!-- REGISTER -->
      <form id="form-register" class="auth-form hidden" novalidate>
        <div class="auth-logo">
          <div class="auth-logo-icon">🚀</div>
          <h2>Créer votre compte</h2>
          <p>Gratuit · Sans carte bancaire</p>
        </div>
        <div class="auth-row">
          <div class="auth-group">
            <label class="auth-label" for="r-first">Prénom</label>
            <input class="auth-input" type="text" id="r-first" placeholder="Jean" autocomplete="given-name" required />
          </div>
          <div class="auth-group">
            <label class="auth-label" for="r-last">Nom</label>
            <input class="auth-input" type="text" id="r-last" placeholder="Dupont" autocomplete="family-name" required />
          </div>
        </div>
        <div class="auth-group">
          <label class="auth-label" for="r-email">Email</label>
          <input class="auth-input" type="email" id="r-email" placeholder="vous@exemple.com" autocomplete="email" required />
        </div>
        <div class="auth-group">
          <label class="auth-label" for="r-pwd">Mot de passe</label>
          <div class="auth-wrap">
            <input class="auth-input" type="password" id="r-pwd" placeholder="8 caractères minimum" autocomplete="new-password" required />
            <button type="button" class="auth-eye" data-t="r-pwd">👁</button>
          </div>
          <div class="auth-strength" id="pwd-strength">
            <div class="strength-track"><div class="strength-bar" id="str-bar"></div></div>
            <span class="strength-lbl" id="str-lbl"></span>
          </div>
        </div>
        <div class="auth-group">
          <label class="auth-label" for="r-confirm">Confirmer</label>
          <div class="auth-wrap">
            <input class="auth-input" type="password" id="r-confirm" placeholder="••••••••" autocomplete="new-password" required />
            <button type="button" class="auth-eye" data-t="r-confirm">👁</button>
          </div>
        </div>
        <label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer">
          <input type="checkbox" id="r-terms" style="margin-top:3px;accent-color:var(--primary);width:15px;height:15px;flex-shrink:0" required />
          <span style="font-size:12px;color:var(--gray-500);line-height:1.5">J'accepte les <a href="#" style="color:var(--primary);font-weight:600">CGU</a> et la <a href="#" style="color:var(--primary);font-weight:600">politique de confidentialité</a></span>
        </label>
        <div id="reg-err" class="auth-err-msg"></div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:13px" id="btn-register">Créer mon compte gratuitement</button>
        <p class="auth-switch">Déjà un compte ? <a href="#" data-tab="login">Se connecter</a></p>
      </form>
    </div>
  </div>`;

  /* ── Fonctions utilitaires ── */
  const q  = (sel, ctx = document) => ctx.querySelector(sel);
  const qa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const showErr = (id, msg) => {
    const el = q('#' + id);
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  };

  const clearErrors = () => {
    qa('.auth-err-msg').forEach(el => el.style.display = 'none');
    qa('.auth-input').forEach(el => el.classList.remove('err'));
  };

  const setLoading = (btn, on) => {
    btn.disabled = on;
    if (on) { btn._orig = btn.innerHTML; btn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></span>'; }
    else if (btn._orig) btn.innerHTML = btn._orig;
  };

  const strength = (pw) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    const lvl = [
      { l: 'Très faible', c: '#DC2626', w: '20%' },
      { l: 'Faible',      c: '#F97316', w: '40%' },
      { l: 'Moyen',       c: '#EAB308', w: '60%' },
      { l: 'Fort',        c: '#22C55E', w: '80%' },
      { l: 'Très fort',   c: '#16A34A', w: '100%' },
    ];
    return lvl[Math.min(s, 4)];
  };

  /* ── Navbar ── */
  const navbarHTML = (user) => `
    <div class="user-menu">
      <button class="user-btn" id="u-btn" aria-expanded="false" aria-label="Mon compte">
        <div class="user-ava">${user.initials}</div>
        <span class="user-btn-name">${user.firstName}</span>
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="user-drop" id="u-drop">
        <div class="user-drop-head">
          <div class="user-ava-lg">${user.initials}</div>
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--gray-900)">${user.firstName} ${user.lastName}</div>
            <div style="font-size:12px;color:var(--gray-400);margin-top:1px">${user.email}</div>
            <span style="display:inline-block;margin-top:5px;background:var(--primary-lighter);color:var(--primary);font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.5px">Plan Gratuit</span>
          </div>
        </div>
        <div class="user-drop-div"></div>
        <button class="user-drop-item">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Mon profil
        </button>
        <button class="user-drop-item">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Mes fichiers récents
        </button>
        <button class="user-drop-item">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
          Paramètres
        </button>
        <button class="user-drop-item danger" id="u-logout">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Déconnexion
        </button>
      </div>
    </div>`;

  const defaultNavHTML = () => `
    <button class="btn btn-secondary auth-open-login">Se connecter</button>
    <button class="btn btn-primary auth-open-register">Commencer gratuitement</button>`;

  const updateNavbar = () => {
    const user = loadUser();
    qa('.nav-actions').forEach(el => {
      el.innerHTML = user ? navbarHTML(user) : defaultNavHTML();
      if (user) wireUserMenu(el);
      else wireAuthBtns(el);
    });
  };

  const wireAuthBtns = (ctx) => {
    q('.auth-open-login', ctx)?.addEventListener('click', () => open('login'));
    q('.auth-open-register', ctx)?.addEventListener('click', () => open('register'));
  };

  const wireUserMenu = (ctx) => {
    const btn  = q('#u-btn', ctx);
    const drop = q('#u-drop', ctx);
    const logoutBtn = q('#u-logout', ctx);
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = drop.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen);
    });
    logoutBtn?.addEventListener('click', logout);
    document.addEventListener('click', () => drop?.classList.remove('open'));
  };

  /* ── Open / Close ── */
  const open = (tab = 'login') => {
    const overlay = q('#auth-overlay');
    if (!overlay) return;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    switchTab(tab);
    setTimeout(() => q(tab === 'login' ? '#l-email' : '#r-first')?.focus(), 120);
  };

  const close = () => {
    const overlay = q('#auth-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    clearErrors();
  };

  const switchTab = (tab) => {
    qa('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    q('#form-login').classList.toggle('hidden', tab !== 'login');
    q('#form-register').classList.toggle('hidden', tab !== 'register');
    clearErrors();
  };

  /* ── Login ── */
  const handleLogin = async (e) => {
    e.preventDefault();
    clearErrors();
    const email = q('#l-email').value.trim();
    const pwd   = q('#l-pwd').value;
    const btn   = q('#btn-login');
    if (!email || !pwd) { showErr('login-err', 'Veuillez remplir tous les champs.'); return; }
    setLoading(btn, true);
    await new Promise(r => setTimeout(r, 800));
    const user = loadUsers().find(u => u.email === email.toLowerCase());
    if (!user || user.password !== btoa(unescape(encodeURIComponent(pwd)))) {
      setLoading(btn, false);
      showErr('login-err', 'Email ou mot de passe incorrect.');
      qa('#l-email,#l-pwd').forEach(i => i.classList.add('err'));
      return;
    }
    persist(user);
    setLoading(btn, false);
    close();
    updateNavbar();
    window.showToast?.(`Bienvenue, ${user.firstName} ! 👋`, 'success');
  };

  /* ── Register ── */
  const handleRegister = async (e) => {
    e.preventDefault();
    clearErrors();
    const first   = q('#r-first').value.trim();
    const last    = q('#r-last').value.trim();
    const email   = q('#r-email').value.trim();
    const pwd     = q('#r-pwd').value;
    const confirm = q('#r-confirm').value;
    const terms   = q('#r-terms').checked;
    const btn     = q('#btn-register');
    if (!first || !last || !email || !pwd) { showErr('reg-err', 'Veuillez remplir tous les champs.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('reg-err', 'Email invalide.'); return; }
    if (pwd.length < 8) { showErr('reg-err', 'Mot de passe trop court (8 caractères minimum).'); return; }
    if (pwd !== confirm) { showErr('reg-err', 'Les mots de passe ne correspondent pas.'); return; }
    if (!terms) { showErr('reg-err', 'Veuillez accepter les conditions d\'utilisation.'); return; }
    setLoading(btn, true);
    await new Promise(r => setTimeout(r, 900));
    const users = loadUsers();
    if (users.find(u => u.email === email.toLowerCase())) {
      setLoading(btn, false);
      showErr('reg-err', 'Un compte existe déjà avec cet email.');
      return;
    }
    const newUser = {
      id: Date.now().toString(), firstName: first, lastName: last,
      email: email.toLowerCase(), initials: (first[0]+last[0]).toUpperCase(),
      password: btoa(unescape(encodeURIComponent(pwd))), plan: 'free',
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
    persist(newUser);
    setLoading(btn, false);
    close();
    updateNavbar();
    window.showToast?.(`Compte créé ! Bienvenue, ${first} 🎉`, 'success');
  };

  const logout = () => {
    persist(null);
    updateNavbar();
    window.showToast?.('Vous avez été déconnecté.', 'info');
  };

  /* ── Init ── */
  const init = () => {
    // CSS
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    // Modal
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
    // Navbar desktop
    updateNavbar();
    // ── Mobile menu buttons ──
    // Wire any btn-secondary/btn-primary inside .mobile-menu-actions
    const wireMobileMenu = () => {
      qa('.mobile-menu-actions button, .mobile-menu button').forEach(btn => {
        if (!btn.dataset.authWired) {
          btn.dataset.authWired = '1';
          if (btn.classList.contains('btn-secondary')) btn.addEventListener('click', () => open('login'));
          if (btn.classList.contains('btn-primary'))   btn.addEventListener('click', () => open('register'));
        }
      });
    };
    wireMobileMenu();
    // Close
    q('#auth-close-btn')?.addEventListener('click', close);
    q('#auth-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'auth-overlay') close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    // Tabs
    qa('.auth-tab, .auth-switch a').forEach(el => {
      el.addEventListener('click', (e) => { e.preventDefault(); if (el.dataset.tab) switchTab(el.dataset.tab); });
    });
    // Forms
    q('#form-login')?.addEventListener('submit', handleLogin);
    q('#form-register')?.addEventListener('submit', handleRegister);
    // Password strength
    q('#r-pwd')?.addEventListener('input', (e) => {
      const pw = e.target.value;
      const sw = q('#pwd-strength');
      if (!pw) { sw.style.display = 'none'; return; }
      sw.style.display = 'flex';
      const { l, c, w } = strength(pw);
      q('#str-bar').style.cssText = `width:${w};background:${c}`;
      q('#str-lbl').textContent = l; q('#str-lbl').style.color = c;
    });
    // Eye toggles
    qa('.auth-eye').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = q('#' + btn.dataset.t);
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        btn.textContent = inp.type === 'password' ? '👁' : '🙈';
      });
    });
  };

  document.addEventListener('DOMContentLoaded', init);

  return { open, close, logout, currentUser: loadUser };
})();
