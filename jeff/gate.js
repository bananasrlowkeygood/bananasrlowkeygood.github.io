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
        background: #eae6f0;
      }
      .gate-card {
        width: 100%; max-width: 430px;
        display: flex; flex-direction: column; gap: 1rem;
        padding: 1.75rem 1.6rem;
        background: #f0ecf8;
        border: 1px solid #c5bee0;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(92,79,122,0.14);
      }
      .gate-title { font-family: "Klee One", cursive; font-size: 1.05rem; color: #14111a; }
      .gate-form { display: flex; gap: 0.45rem; }
      .gate-input {
        flex: 1 1 auto; min-width: 0;
        padding: 0 0.7rem; height: 34px;
        font-family: inherit; font-size: 0.9rem; color: #14111a;
        background: #fff;
        border: 1px solid #c5bee0; border-radius: 6px;
      }
      .gate-input:focus { outline: none; border-color: #5c4f7a; }
      .gate-go {
        height: 34px; padding: 0 14px;
        border: none; border-radius: 6px; cursor: pointer;
        background: #5c4f7a; color: #f0ecf8;
        font-family: "Klee One", cursive; font-size: 0.82rem;
      }
      .gate-go:hover { background: #6e5f90; }
      .gate-note {
        font-family: "Klee One", cursive; font-size: 0.82rem; color: #5c4f7a;
        overflow-wrap: anywhere;
      }
      .gate-note:empty { display: none; }
      .gate-card.wrong { animation: gate-shake 0.32s; }
      @keyframes gate-shake {
        0%,100% { transform: translateX(0); }
        25%     { transform: translateX(-6px); }
        75%     { transform: translateX(6px); }
      }
    `;
    document.head.appendChild(style);
  }

  function paintVeil(inner) {
    paintStyle();
    const veil = document.createElement('div');
    veil.className = 'gate-veil';
    veil.innerHTML = `<div class="gate-card"><div class="gate-title">jeff</div>${inner}</div>`;
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
        <button class="gate-go" type="button">sign in with Google</button>
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
