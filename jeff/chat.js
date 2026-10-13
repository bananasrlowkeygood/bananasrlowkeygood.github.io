/* ── Chat ──
 *
 * CHAT.mount(el, { about }) fills `el` with a conversation: everyone else who
 * has signed in along the top, what you and the one picked have said beneath,
 * and a box to say more. `about` is the question ids a message is about, shown
 * as a chip you can take off; change them later with the returned
 * handle.about(ids), and turn to someone with handle.to(uid). Needs store.js
 * and an account.
 *
 * CHAT.note(uid, qids) leaves those questions in the conversation, for when
 * they were sent some other way.
 */
(function () {
  'use strict';

  const css = document.createElement('style');
  css.textContent = `
    .chat, .chat * { font-family: "Klee One", cursive; box-sizing: border-box; }
    .chat { display: flex; flex-direction: column; min-height: 0; color: #14111a; }
    .chat-head { display: flex; align-items: baseline; gap: 0.6rem; flex-shrink: 0; }
    .chat-title { font-size: 1rem; }
    .chat-with { font-size: 0.78rem; color: #5c4f7a; opacity: 0.7; text-transform: lowercase; }

    .chat-people {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      flex-shrink: 0;
      max-height: 4.6rem;
      overflow-y: auto;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid #c5bee0;
    }
    .chat-people:empty { display: none; }
    .chat-person {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      height: 24px;
      padding: 0 0.6rem;
      border: 1px solid #c5bee0;
      border-radius: 99px;
      background: transparent;
      color: #5c4f7a;
      font-size: 0.74rem;
      text-transform: lowercase;
      white-space: nowrap;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .chat-person:hover { background: rgba(92,79,122,0.08); border-color: #5c4f7a; }
    .chat-person.on, .chat-person.on:hover { background: #5c4f7a; border-color: #5c4f7a; color: #f0ecf8; }
    .chat-person i { width: 6px; height: 6px; border-radius: 50%; background: #c98a00; }

    .chat-log {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      overflow-y: auto;
      margin: 0.5rem -0.35rem 0;
      padding: 0.25rem 0.35rem 0.5rem;
      overscroll-behavior: contain;
    }
    .chat-none { margin: auto; font-size: 0.78rem; color: #9a9a9a; }
    .chat-day { align-self: center; margin: 0.6rem 0 0.25rem; font-size: 0.68rem; color: #5c4f7a; opacity: 0.6; }
    .chat-day:first-child { margin-top: 0; }

    .chat-msg {
      align-self: flex-start;
      max-width: 86%;
      padding: 0.35rem 0.65rem 0.4rem;
      border: 1px solid #dcd6ee;
      border-radius: 12px 12px 12px 3px;
      background: #fbf9fe;
      font-size: 0.82rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .chat-msg.mine {
      align-self: flex-end;
      border-color: #5c4f7a;
      border-radius: 12px 12px 3px 12px;
      background: #5c4f7a;
      color: #f0ecf8;
    }
    .chat-msg.new { margin-top: 0.35rem; }
    .chat-qs { display: flex; flex-wrap: wrap; gap: 0.25rem; padding: 0.1rem 0; }
    .chat-qs + .chat-text { margin-top: 0.2rem; }
    .chat-q, .chat-more {
      padding: 0.02rem 0.4rem;
      border: 1px solid #c5bee0;
      border-radius: 4px;
      font-size: 0.68rem;
      color: #5c4f7a;
      text-decoration: none;
    }
    a.chat-q:hover { background: rgba(92,79,122,0.14); }
    .chat-more { border-color: transparent; padding-left: 0; }
    .chat-msg.mine .chat-q, .chat-msg.mine .chat-more { border-color: rgba(240,236,248,0.45); color: #f0ecf8; }
    .chat-msg.mine a.chat-q:hover { background: rgba(240,236,248,0.16); }
    .chat-msg.mine .chat-more { border-color: transparent; }
    .chat-when { align-self: flex-start; margin: 0 0.3rem; font-size: 0.64rem; color: #9a9a9a; }
    .chat-when.mine { align-self: flex-end; }

    .chat-box {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.4rem;
      flex-shrink: 0;
      padding-top: 0.55rem;
      border-top: 1px solid #c5bee0;
    }
    .chat-about { display: flex; flex-wrap: wrap; gap: 0.25rem; width: 100%; }
    .chat-about:empty { display: none; }
    .chat-about button {
      height: 20px;
      padding: 0 0.4rem;
      border: 1px solid #c5bee0;
      border-radius: 4px;
      background: transparent;
      color: #9a9a9a;
      font-size: 0.68rem;
      text-decoration: line-through;
      cursor: pointer;
    }
    .chat-about button.on { background: rgba(92,79,122,0.1); border-color: #5c4f7a; color: #5c4f7a; text-decoration: none; }
    .chat-box textarea {
      flex: 1 1 8rem;
      min-width: 0;
      height: 30px;
      max-height: 7.5rem;
      padding: 0.3rem 0.6rem;
      border: 1px solid #c5bee0;
      border-radius: 6px;
      background: #fbf9fe;
      color: #14111a;
      font-size: 0.82rem;
      line-height: 1.35;
      outline: none;
      resize: none;
    }
    .chat-box textarea:focus { border-color: #5c4f7a; }
    .chat-box textarea::placeholder { color: #5c4f7a; opacity: 0.5; }
    .chat-send {
      height: 30px;
      padding: 0 12px;
      border: none;
      border-radius: 6px;
      background: #5c4f7a;
      color: #f0ecf8;
      font-size: 0.78rem;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    .chat-send:hover { background: #6e5f90; }
    .chat-send:disabled, .chat-send:disabled:hover { background: #e4e4e4; color: #9a9a9a; cursor: default; }
  `;
  document.head.appendChild(css);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clean = ids => (ids || []).map(q => String(q).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const dayOf = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase();
  const timeOf = t => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const SHOWN = 12;   // question chips in one message before the rest are counted

  const LAST = 'jeff-chat-to';

  function mount(el, opts) {
    opts = opts || {};
    el.classList.add('chat');
    el.innerHTML =
      `<div class="chat-head"><span class="chat-title">chat</span><span class="chat-with"></span></div>` +
      `<div class="chat-people"></div>` +
      `<div class="chat-log"><span class="chat-none">…</span></div>` +
      `<form class="chat-box"><div class="chat-about"></div>` +
        `<textarea rows="1" placeholder="message" aria-label="message" disabled></textarea>` +
        `<button type="submit" class="chat-send" disabled>send</button></form>`;
    const $ = sel => el.querySelector(sel);
    const peopleEl = $('.chat-people'), log = $('.chat-log'), box = $('textarea'), sendBtn = $('.chat-send'), aboutEl = $('.chat-about');

    let people = [];        // everyone else: [{ uid, name }]
    const meta = {};        // uid -> where the conversation with them stands
    let open = null;        // who is picked
    let msgs = null;        // what has been said with them; null until known
    let failed = false;
    let stopThread = null;
    let about = clean(opts.about), off = new Set();   // ids on offer, and the ones taken off
    let asked = null;       // someone to turn to, asked for before the list was in

    const none = text => { log.innerHTML = `<span class="chat-none">${esc(text)}</span>`; };

    function paintPeople() {
      // Whoever spoke last comes first; the rest by name.
      const order = people.slice().sort((a, b) =>
        ((meta[b.uid] || {}).t || 0) - ((meta[a.uid] || {}).t || 0) || a.name.localeCompare(b.name));
      peopleEl.innerHTML = order.map(p =>
        `<button type="button" class="chat-person${p.uid === open ? ' on' : ''}" data-uid="${esc(p.uid)}">` +
        `${esc(p.name)}${(meta[p.uid] || {}).unread && p.uid !== open ? '<i title="unread"></i>' : ''}</button>`).join('');
      const who = people.find(p => p.uid === open);
      $('.chat-with').textContent = who ? who.name : '';
    }

    function paintAbout() {
      aboutEl.innerHTML = about.map(id =>
        `<button type="button" class="${off.has(id) ? '' : 'on'}" data-id="${esc(id)}" title="About this question">${esc(id)}</button>`).join('');
      ready();
    }

    const attached = () => about.filter(id => !off.has(id));

    function ready() {
      box.disabled = !open || failed;
      sendBtn.disabled = box.disabled || !(box.value.trim() || attached().length);
    }

    function paintLog(stay) {
      if (failed) return none("can't load chat");
      if (!msgs) return none('…');
      if (!msgs.length) return none('no messages yet');
      const pinned = !stay || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      const seen = (meta[open] || {}).seen || 0;
      let html = '', day = '';
      msgs.forEach((m, i) => {
        const d = dayOf(m.t || 0), prev = msgs[i - 1], next = msgs[i + 1];
        if (d !== day) { day = d; html += `<div class="chat-day">${esc(d)}</div>`; }
        const ids = clean(m.qids);
        const chips = ids.slice(0, SHOWN).map(id => `<a class="chat-q" href="quiz.html?q=${id}">${id}</a>`).join('') +
          (ids.length > SHOWN ? `<a class="chat-q chat-more" href="quiz.html?q=${ids.join(',')}">and ${ids.length - SHOWN} more</a>` : '');
        const turn = !prev || prev.mine !== m.mine || dayOf(prev.t || 0) !== d;
        html += `<div class="chat-msg${m.mine ? ' mine' : ''}${turn ? ' new' : ''}">` +
          (chips ? `<div class="chat-qs">${chips}</div>` : '') +
          (m.text ? `<div class="chat-text">${esc(m.text)}</div>` : '') + `</div>`;
        // The time goes under the last of a run, and "seen" under your last.
        const last = !next || next.mine !== m.mine || (next.t || 0) - (m.t || 0) > 5 * 60000;
        if (last) {
          html += `<div class="chat-when${m.mine ? ' mine' : ''}">${esc(timeOf(m.t || 0))}` +
            `${m.mine && !next && seen >= (m.t || 0) ? ', seen' : ''}</div>`;
        }
      });
      log.innerHTML = html;
      if (pinned) log.scrollTop = log.scrollHeight;
    }

    function pick(uid) {
      if (uid === open || !people.some(p => p.uid === uid)) return;
      if (stopThread) stopThread();
      open = uid; msgs = null; failed = false;
      try { localStorage.setItem(LAST, uid); } catch (e) {}
      paintPeople(); paintLog(); ready();
      stopThread = STORE.watchThread(uid, list => {
        if (open !== uid) return;
        const first = !msgs;
        failed = !list; msgs = list || [];
        paintLog(!first); ready();
        if ((meta[uid] || {}).unread) STORE.readChat(uid);
      });
    }

    peopleEl.addEventListener('click', e => {
      const b = e.target.closest('[data-uid]');
      if (b) { pick(b.dataset.uid); box.focus(); }
    });

    aboutEl.addEventListener('click', e => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      if (!off.delete(b.dataset.id)) off.add(b.dataset.id);
      paintAbout();
    });

    const fit = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight + 2, 120)}px`; };
    box.addEventListener('input', () => { fit(); ready(); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('.chat-box').requestSubmit(); }
    });

    $('.chat-box').addEventListener('submit', async e => {
      e.preventDefault();
      const text = box.value.trim(), ids = attached();
      if (!open || !(text || ids.length)) return;
      box.value = ''; fit();
      // Said once about a question, the next message needn't say it again.
      ids.forEach(id => off.add(id));
      paintAbout();
      if (!await STORE.say(open, text, ids)) {
        box.value = text; fit();
        ids.forEach(id => off.delete(id));
        paintAbout();
        SHARE.flash(sendBtn, 'not sent');
      }
    });

    (async () => {
      const list = await STORE.people(15000);
      if (!list) { failed = true; paintLog(); return; }
      people = list;
      if (!people.length) { paintPeople(); none('no one else yet'); return; }
      people.forEach(p => STORE.watchChat(p.uid, m => {
        if (!m) return;
        meta[p.uid] = m;
        paintPeople();
        if (p.uid === open) {
          if (m.unread) STORE.readChat(p.uid);
          if (msgs) paintLog(true);
        }
      }));
      let was = null;
      try { was = localStorage.getItem(LAST); } catch (e) {}
      paintPeople();
      pick(people.some(p => p.uid === asked) ? asked : people.some(p => p.uid === was) ? was : people[0].uid);
    })();

    paintAbout();

    return {
      // The questions the next message is about.
      about(ids) {
        ids = clean(ids);
        if (ids.join() === about.join()) return;
        about = ids; off = new Set();
        paintAbout();
      },
      // Turn to this person.
      to(uid) { asked = uid; pick(uid); }
    };
  }

  window.CHAT = {
    mount,
    note(uid, qids) { return STORE.say(uid, '', qids); }
  };
})();
