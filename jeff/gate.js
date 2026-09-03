/* ── The gate ──
 *
 * The bank sits in a public repo, so hiding it behind a password check would
 * be theatre — the files are one curl away. Instead the questions are stored
 * encrypted and the puzzle answer *is* the key: it gets stretched with PBKDF2
 * and the result decrypts them. There is no answer in this file to find, and
 * a wrong one produces a key that simply doesn't work.
 *
 * The derived key is kept in localStorage, so the puzzle is solved once per
 * browser and never again.
 */
(function () {
  'use strict';

  const STORE_KEY = 'jeff-gate-key';
  const CANARY    = 'jeff-unlocked';

  const b64d = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  const b64e = b => btoa(String.fromCharCode(...new Uint8Array(b)));

  // Must match normalize() in tools/lockbank.py exactly, or the key differs.
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  let config = null;   // gate.json
  let key    = null;   // CryptoKey, once unlocked
  let opened = null;   // the promise every page waits on

  async function gateConfig() {
    if (!config) {
      const r = await fetch('gate.json?t=' + Date.now());
      if (!r.ok) throw new Error('gate.json missing');
      config = await r.json();
    }
    return config;
  }

  async function importKey(raw) {
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  }

  async function deriveRaw(answer, cfg) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(normalize(answer)), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: b64d(cfg.salt), iterations: cfg.iters, hash: 'SHA-256' },
      base, 256);
  }

  async function decryptBlob(k, blob) {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64d(blob.iv) }, k, b64d(blob.ct));
    return new TextDecoder().decode(plain);
  }

  // A key is only accepted if it opens the canary in gate.json, so a stale key
  // from before a re-lock is rejected instead of failing later on every file.
  async function accepts(k, cfg) {
    try {
      return (await decryptBlob(k, cfg.check)) === CANARY;
    } catch (e) { return false; }
  }

  async function tryAnswer(answer) {
    const cfg = await gateConfig();
    const raw = await deriveRaw(answer, cfg);
    const k   = await importKey(raw);
    if (!(await accepts(k, cfg))) return false;
    key = k;
    try { localStorage.setItem(STORE_KEY, b64e(raw)); } catch (e) { /* private mode */ }
    return true;
  }

  async function keyFromStorage() {
    let saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) { return false; }
    if (!saved) return false;
    try {
      const k = await importKey(b64d(saved));
      if (await accepts(k, await gateConfig())) { key = k; return true; }
    } catch (e) { /* corrupt entry */ }
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    return false;
  }

  // ── The puzzle screen ──
  function paintGate(cfg) {
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
      .gate-title {
        font-family: "Klee One", cursive;
        font-size: 1.05rem; color: #14111a;
      }
      .gate-riddle {
        font-size: 0.92rem; line-height: 1.65; color: #3d3550;
        white-space: pre-wrap;
      }
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
      .gate-go:hover:not(:disabled) { background: #6e5f90; }
      .gate-go:disabled { opacity: 0.55; cursor: default; }
      .gate-note { font-size: 0.76rem; color: #5c4f7a; opacity: 0.75; min-height: 1.1em; }
      .gate-note.bad { color: #b03030; opacity: 1; }
      .gate-card.wrong { animation: gate-shake 0.32s; }
      @keyframes gate-shake {
        0%,100% { transform: translateX(0); }
        25%     { transform: translateX(-6px); }
        75%     { transform: translateX(6px); }
      }
    `;
    document.head.appendChild(style);

    const veil = document.createElement('div');
    veil.className = 'gate-veil';
    veil.innerHTML = `
      <div class="gate-card">
        <div class="gate-title">jeff</div>
        <div class="gate-riddle"></div>
        <form class="gate-form">
          <input class="gate-input" type="text" autocomplete="off" autocapitalize="none"
                 spellcheck="false" aria-label="jeff">
          <button class="gate-go" type="submit">enter</button>
        </form>
        <div class="gate-note"></div>
      </div>`;

    const card  = veil.querySelector('.gate-card');
    const input = veil.querySelector('.gate-input');
    const go    = veil.querySelector('.gate-go');
    const note  = veil.querySelector('.gate-note');
    const riddle = veil.querySelector('.gate-riddle');
    if (cfg.prompt) riddle.textContent = cfg.prompt;
    else riddle.remove();

    document.body.appendChild(veil);
    input.focus();

    return new Promise(resolve => {
      veil.querySelector('.gate-form').addEventListener('submit', async e => {
        e.preventDefault();
        const answer = input.value;
        if (!normalize(answer)) return;

        go.disabled = true;
        note.className = 'gate-note';
        note.textContent = 'checking…';   // PBKDF2 takes a beat on purpose

        const ok = await tryAnswer(answer);
        if (ok) {
          note.textContent = 'welcome back.';
          veil.remove();
          resolve();
          return;
        }

        go.disabled = false;
        note.className = 'gate-note bad';
        note.textContent = 'not it.';
        card.classList.add('wrong');
        setTimeout(() => card.classList.remove('wrong'), 340);
        input.select();
      });
    });
  }

  // ── Public surface ──
  const GATE = {
    // Resolves once we hold a working key — immediately for a browser that has
    // already solved it, otherwise after the puzzle screen is answered.
    ready() {
      if (!opened) {
        opened = (async () => {
          const cfg = await gateConfig();
          if (await keyFromStorage()) return;
          await paintGate(cfg);
        })();
      }
      return opened;
    },

    // Fetch and parse, decrypting when the file is locked. Plaintext files are
    // passed straight through, so a block that hasn't been locked still works.
    async getJSON(url) {
      const r = await fetch(url);
      if (!r.ok) return null;
      const body = await r.json();
      if (!(body && body.v === 1 && body.iv && body.ct)) return body;
      if (!key) throw new Error('locked');
      return JSON.parse(await decryptBlob(key, body));
    },

    // Forget this browser's key — the puzzle is asked again next visit.
    forget() {
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      key = null;
      location.reload();
    }
  };

  window.GATE = GATE;
})();
