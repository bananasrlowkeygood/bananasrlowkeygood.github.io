/* ── Sending questions ──
 *
 * SHARE.pick(button, qids) opens a small list of everyone else who has signed
 * in, under the button. Picking a name puts those questions in that person's
 * inbox. Needs store.js, and an account: SHARE.able() says whether there is one.
 */
(function () {
  'use strict';

  const css = document.createElement('style');
  css.textContent = `
    .share-pop {
      position: absolute;
      z-index: 40;
      display: flex;
      flex-direction: column;
      min-width: 9rem;
      max-height: 15rem;
      overflow-y: auto;
      padding: 0.25rem;
      background: #fbf9fe;
      border: 1px solid #c5bee0;
      border-radius: 8px;
      box-shadow: 0 10px 34px rgba(92,79,122,0.22);
    }
    .share-pop button {
      height: auto;
      padding: 0.35rem 0.6rem;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: #5c4f7a;
      font-family: inherit;
      font-size: 0.78rem;
      text-align: left;
      text-transform: lowercase;
      white-space: nowrap;
      cursor: pointer;
    }
    .share-pop button:hover { background: rgba(92,79,122,0.1); }
    .share-pop span { padding: 0.35rem 0.6rem; font-size: 0.78rem; color: #9a9a9a; }
  `;
  document.head.appendChild(css);

  let pop = null, opener = null;

  function close() {
    if (pop) pop.remove();
    pop = null;
  }

  document.addEventListener('click', e => {
    if (pop && !pop.contains(e.target) && !opener.contains(e.target)) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', close);

  // Say so on the button itself, then put its label back.
  function flash(button, text) {
    const was = button.dataset.label || (button.dataset.label = button.textContent);
    button.textContent = text;
    clearTimeout(button._flash);
    button._flash = setTimeout(() => { button.textContent = was; }, 1400);
  }

  window.SHARE = {
    flash,

    // Whether there is an account to send from.
    able() { return STORE.online(15000).then(on => on === true); },

    async pick(button, qids) {
      if (pop) { close(); return; }
      if (!qids.length) return;
      opener = button;
      const mine = pop = document.createElement('div');
      pop.className = 'share-pop';
      pop.innerHTML = '<span>…</span>';
      document.body.appendChild(pop);
      const box = button.getBoundingClientRect();
      pop.style.top = `${box.bottom + window.scrollY + 6}px`;
      pop.style.left = `${Math.max(8, Math.min(box.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 170))}px`;

      const people = await STORE.people(15000);
      if (pop !== mine) return;   // closed while waiting
      pop.innerHTML = '';
      if (!people || !people.length) {
        const none = document.createElement('span');
        none.textContent = people ? 'no one else yet' : "can't load the list";
        pop.appendChild(none);
        return;
      }
      people.forEach(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = p.name;
        b.onclick = async e => {
          e.stopPropagation();
          close();
          flash(button, await STORE.sendTo(p.uid, qids) ? 'sent' : 'not sent');
        };
        pop.appendChild(b);
      });
    }
  };
})();
