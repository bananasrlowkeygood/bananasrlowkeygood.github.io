/* ── The gate ──
 *
 * Who gets in. With a Firebase config (firebase-config.js) that is a Google
 * sign-in checked against an allowlist of emails; each person then has their
 * own history, kept by store.js. Without one it falls back to the old shared
 * password, answered once per browser.
 *
 * Worth knowing what this is and isn't: the questions are plain JSON in a
 * public repo, so either gate stops a casual visitor, not a determined one.
 * What the accounts do protect is each person's history — the Firestore rules
 * (firestore.rules) only hand it to its owner.
 */
(function () {
  'use strict';

  const CFG = window.FIREBASE_CONFIG || null;
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

  // The last person let in on this browser, so a return visit opens at once
  // (and works offline) while the sign-in is re-checked behind it.
  const WHO_KEY = 'jeff-who';

  // ── Shared password (no Firebase config) ──
  const PASS_HASH = 'f5af74c371472adc35cafbc396d7168fd8a48f096fb98c6f1273cbe3cf6732c6';
  const STORE_KEY = 'jeff-gate';

  // Fold case and punctuation, so "Rectal-Prolapse!" gets in too.
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const isOpen = () => {
    try { return localStorage.getItem(STORE_KEY) === PASS_HASH; } catch (e) { return false; }
  };

  let styled = false;

  function paintStyle() {
    if (styled) return;
    styled = true;
    const style = document.createElement('style');
    style.textContent = `
      .gate-veil {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        padding: 1.25rem;
        background:
          radial-gradient(60rem 34rem at 50% 38%, #f6f2fc 0%, rgba(246,242,252,0) 70%),
          #eae6f0;
      }
      .gate-card {
        position: relative;
        width: 100%; max-width: 340px;
        display: flex; flex-direction: column; align-items: stretch; gap: 1.1rem;
        padding: 4.4rem 1.75rem 1.75rem;
        background: #fbf9fe;
        border: 1px solid #d6cfe8;
        border-radius: 20px;
        box-shadow: 0 1px 2px rgba(92,79,122,0.08), 0 18px 50px rgba(92,79,122,0.16);
        text-align: center;
        animation: gate-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      }
      /* The sloths sit on the card's top edge. */
      .gate-logo {
        position: absolute; left: 50%; top: -62px;
        width: 150px; height: auto;
        transform: translateX(-50%);
        filter: drop-shadow(0 6px 10px rgba(92,79,122,0.18));
        pointer-events: none;
        -webkit-user-select: none; user-select: none;
      }
      .gate-title {
        font-family: "Klee One", cursive;
        font-size: 1.7rem; line-height: 1.1;
        color: #2c2440;
      }
      .gate-form { display: flex; gap: 0.5rem; }
      .gate-input {
        flex: 1 1 auto; min-width: 0;
        padding: 0 0.8rem; height: 42px;
        font-family: inherit; font-size: 0.9rem; color: #14111a;
        background: #fff;
        border: 1px solid #d6cfe8; border-radius: 10px;
      }
      .gate-input:focus { outline: none; border-color: #5c4f7a; box-shadow: 0 0 0 3px rgba(92,79,122,0.14); }
      .gate-go {
        display: inline-flex; align-items: center; justify-content: center; gap: 0.6rem;
        height: 42px; padding: 0 16px;
        border: none; border-radius: 10px; cursor: pointer;
        background: #5c4f7a; color: #f6f2fc;
        font-family: "Klee One", cursive; font-size: 0.9rem;
        transition: background-color 0.15s, box-shadow 0.15s, transform 0.08s;
      }
      .gate-go:hover { background: #6e5f90; }
      .gate-go:active { transform: translateY(1px); }
      .gate-go:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(92,79,122,0.28); }

      /* Google's own button: white, with the mark. */
      .gate-go.google {
        background: #fff; color: #2c2440;
        border: 1px solid #d6cfe8;
        box-shadow: 0 1px 2px rgba(92,79,122,0.10);
      }
      .gate-go.google:hover {
        background: #fff; border-color: #5c4f7a;
        box-shadow: 0 4px 14px rgba(92,79,122,0.16);
      }
      .gate-go.google svg { width: 18px; height: 18px; flex-shrink: 0; }

      .gate-note {
        font-family: "Klee One", cursive; font-size: 0.85rem; color: #5c4f7a;
        overflow-wrap: anywhere;
      }
      .gate-note:empty { display: none; }
      .gate-card.wrong { animation: gate-shake 0.32s; }
      @keyframes gate-in {
        from { opacity: 0; transform: translateY(10px) scale(0.98); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes gate-shake {
        0%,100% { transform: translateX(0); }
        25%     { transform: translateX(-6px); }
        75%     { transform: translateX(6px); }
      }
      @media (prefers-reduced-motion: reduce) {
        .gate-card { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function paintVeil(inner) {
    paintStyle();
    const veil = document.createElement('div');
    veil.className = 'gate-veil';
    veil.innerHTML = `<div class="gate-card">
        <img class="gate-logo" src="../static/assets/logo.png" alt="">
        <div class="gate-title">jeff</div>${inner}</div>`;
    document.body.appendChild(veil);
    return veil;
  }

  function shake(veil) {
    const card = veil.querySelector('.gate-card');
    card.classList.add('wrong');
    setTimeout(() => card.classList.remove('wrong'), 340);
  }

  function paintGate() {
    const veil = paintVeil(`
        <form class="gate-form">
          <input class="gate-input" type="password" autocomplete="off" autocapitalize="none"
                 spellcheck="false" aria-label="jeff">
          <button class="gate-go" type="submit">enter</button>
        </form>`);

    const input = veil.querySelector('.gate-input');
    input.focus();

    return new Promise(resolve => {
      veil.querySelector('.gate-form').addEventListener('submit', async e => {
        e.preventDefault();
        if (await sha256(normalize(input.value)) === PASS_HASH) {
          try { localStorage.setItem(STORE_KEY, PASS_HASH); } catch (err) { /* private mode */ }
          veil.remove();
          resolve();
          return;
        }
        shake(veil);
        input.select();
      });
    });
  }

  // ── Accounts (Firebase config present) ──
  const cachedWho = () => {
    try {
      const w = JSON.parse(localStorage.getItem(WHO_KEY) || 'null');
      return w && w.uid ? w : null;
    } catch (e) { return null; }
  };

  const describe = u => ({ uid: u.uid, email: u.email || '', name: u.displayName || u.email || '' });

  function remember(user) {
    try { localStorage.setItem(WHO_KEY, JSON.stringify(describe(user))); } catch (e) {}
  }

  function forgetWho() {
    try { localStorage.removeItem(WHO_KEY); } catch (e) {}
  }

  const GOOGLE_MARK = '<svg viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    '</svg>';

  let sdkP = null;

  function loadSdk() {
    if (!sdkP) {
      sdkP = Promise.all(['app', 'auth', 'firestore'].map(n => import(SDK + 'firebase-' + n + '.js')))
        .then(([appM, A, fs]) => {
          const app = appM.initializeApp(CFG);
          let db;
          // Keeps a copy on the device and queues writes made offline. Not
          // every browser allows it (private windows), so fall back quietly.
          try {
            db = fs.initializeFirestore(app, {
              localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
            });
          } catch (e) { db = fs.getFirestore(app); }
          return { A, fs, db, auth: A.getAuth(app) };
        });
    }
    return sdkP;
  }

  // Whoever the browser already has signed in, once Firebase has worked it out.
  const currentUser = sdk => new Promise(resolve => {
    const off = sdk.A.onAuthStateChanged(sdk.auth, u => { off(); resolve(u); });
  });

  // true / false, or null when it couldn't be checked (offline).
  async function onList(sdk, user) {
    try {
      return (await sdk.fs.getDoc(sdk.fs.doc(sdk.db, 'allowlist', user.email || '-'))).exists();
    } catch (e) {
      return e && e.code === 'permission-denied' ? false : null;
    }
  }

  function askSignIn(sdk) {
    const veil = paintVeil(`
        <button class="gate-go google" type="button">${GOOGLE_MARK}sign in with Google</button>
        <div class="gate-note"></div>`);
    const note = veil.querySelector('.gate-note');

    return new Promise(resolve => {
      veil.querySelector('.gate-go').addEventListener('click', async () => {
        try {
          const res = await sdk.A.signInWithPopup(sdk.auth, new sdk.A.GoogleAuthProvider());
          veil.remove();
          resolve(res.user);
        } catch (e) {
          const code = (e && e.code) || '';
          if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
          note.textContent = code.replace('auth/', '').replace(/-/g, ' ') || 'sign-in failed';
          shake(veil);
        }
      });
    });
  }

  // Signed in, but not someone this is open to. Resolves once they sign out.
  function turnAway(sdk, user, checked) {
    const veil = paintVeil(`
        <div class="gate-note"></div>
        <button class="gate-go" type="button">switch account</button>`);
    veil.querySelector('.gate-note').textContent = checked
      ? `${user.email} isn't on the list`
      : `couldn't check ${user.email}`;

    return new Promise(resolve => {
      veil.querySelector('.gate-go').addEventListener('click', async () => {
        try { await sdk.A.signOut(sdk.auth); } catch (e) {}
        veil.remove();
        resolve();
      });
    });
  }

  function unreachable() {
    const veil = paintVeil(`
        <div class="gate-note">can't reach sign-in</div>
        <button class="gate-go" type="button">retry</button>`);
    veil.querySelector('.gate-go').addEventListener('click', () => location.reload());
    return new Promise(() => {});
  }

  // Runs until someone on the list is signed in.
  async function enter(who) {
    const sdk = await loadSdk();
    let user = await currentUser(sdk);
    for (;;) {
      if (!user) user = await askSignIn(sdk);
      const ok = await onList(sdk, user);
      // Offline, someone already let in on this browser stays in.
      if (ok || (ok === null && who && who.uid === user.uid)) break;
      forgetWho();
      await turnAway(sdk, user, ok !== null);
      user = null;
    }
    remember(user);
    return { sdk, user };
  }

  let opened = null;
  let cloud  = Promise.resolve(null);

  function openAccounts() {
    const who  = cachedWho();
    const flow = enter(who);

    cloud = flow.then(({ sdk, user }) => ({ db: sdk.db, fs: sdk.fs, uid: user.uid }), () => null);

    if (who) {
      // Open now on what this browser remembers; if the sign-in turns out to
      // be someone else, start over as them.
      flow.then(({ user }) => { if (user.uid !== who.uid) location.reload(); }, () => {});
      return Promise.resolve(who);
    }
    return flow.then(({ user }) => describe(user), unreachable);
  }

  window.GATE = {
    // Resolves with { uid, email, name } once someone is let in, or with null
    // when the site is running on the shared password instead of accounts.
    ready() {
      if (!opened) {
        opened = CFG ? openAccounts()
                     : (isOpen() ? Promise.resolve() : paintGate()).then(() => null);
      }
      return opened;
    },

    // Resolves with { db, fs, uid } once the sign-in is confirmed, or null
    // when there is nowhere to sync to (no accounts, or offline).
    cloud() { return cloud; },

    // Sign out — or, on the shared password, forget this browser — so the
    // next visit is asked again.
    async forget() {
      forgetWho();
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      if (CFG) {
        try { const sdk = await loadSdk(); await sdk.A.signOut(sdk.auth); } catch (e) {}
      }
      location.reload();
    }
  };
})();
