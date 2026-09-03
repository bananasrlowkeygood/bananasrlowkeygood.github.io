/* ── The gate ──
 *
 * A password screen in front of the bank, answered once per browser and then
 * remembered. It keeps the site from opening for someone who just has the
 * link.
 *
 * Worth knowing what this is and isn't: the questions are plain JSON in a
 * public repo, so this stops a casual visitor, not a determined one. Anyone
 * who opens devtools or fetches the JSON directly walks straight past it.
 * The password is stored here as a SHA-256 hash only, so at least reading
 * this file doesn't hand it over.
 */
(function () {
  'use strict';

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

  function paintGate() {
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
        <form class="gate-form">
          <input class="gate-input" type="password" autocomplete="off" autocapitalize="none"
                 spellcheck="false" aria-label="jeff">
          <button class="gate-go" type="submit">enter</button>
        </form>
      </div>`;

    const card  = veil.querySelector('.gate-card');
    const input = veil.querySelector('.gate-input');

    document.body.appendChild(veil);
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
        card.classList.add('wrong');
        setTimeout(() => card.classList.remove('wrong'), 340);
        input.select();
      });
    });
  }

  let opened = null;

  window.GATE = {
    // Resolves at once for a browser that has already been let in, otherwise
    // after the password screen is answered.
    ready() {
      if (!opened) opened = isOpen() ? Promise.resolve() : paintGate();
      return opened;
    },

    // Forget this browser — the password is asked again next visit.
    forget() {
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      location.reload();
    }
  };
})();
