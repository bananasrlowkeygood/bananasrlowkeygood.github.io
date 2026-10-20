/* ── Chat ──
 *
 * CHAT.mount(el, { fold, onUnread }) fills `el` with everyone else who has signed
 * in, a card each. Pick one and it turns to what has passed between you: the
 * questions you sent each other, as cards saying what became of them, and
 * what you have said, with a box to say more. `fold` puts a hide button in the title.
 * `onUnread(n)` hears how many people have said something you haven't read.
 * It returns { back() }, which goes back to everyone. Needs store.js and an account.
 */
(function () {
  'use strict';

  const css = document.createElement('style');
  css.textContent = `
    .chat, .chat * { font-family: "Klee One", cursive; box-sizing: border-box; }
    .chat { display: flex; flex-direction: column; min-height: 0; color: #14111a; }
    .chat-head { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; min-height: 22px; }
    .chat-title { font-size: 1rem; }
    .chat-with { flex: 1 1 auto; min-width: 0; font-size: 1rem; text-transform: lowercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat-back {
      height: 22px;
      padding: 0 0.5rem;
      border: 1px solid #c5bee0;
      border-radius: 5px;
      background: transparent;
      color: #5c4f7a;
      font-size: 0.74rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .chat-back:hover { border-color: #5c4f7a; background: rgba(92,79,122,0.06); }
    .chat-head [data-fold] { margin-left: auto; }
    .chat [hidden] { display: none; }

    /* Everyone, a card each. */
    .chat-people {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-height: 0;
      overflow-y: auto;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid #c5bee0;
    }
    .chat-person {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.1rem 0.6rem;
      align-items: baseline;
      width: 100%;
      height: auto;
      padding: 0.4rem 0.55rem;
      border: none;
      border-radius: 6px;
      background: rgba(92,79,122,0.06);
      color: #5c4f7a;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s;
    }
    .chat-person:hover { background: rgba(92,79,122,0.14); }
    .chat-name { font-size: 0.84rem; color: #14111a; text-transform: lowercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat-at { font-size: 0.66rem; opacity: 0.65; white-space: nowrap; }
    .chat-last { font-size: 0.72rem; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat-last:empty { display: none; }
    .chat-dot { align-self: center; justify-self: end; width: 7px; height: 7px; border-radius: 50%; background: #c98a00; }

    .chat-thread { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; margin-top: 0.5rem; border-top: 1px solid #c5bee0; }
    .chat-log {
      flex: 1 1 auto;
      min-height: 5rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      overflow-y: auto;
      margin: 0 -0.35rem;
      padding: 0.6rem 0.35rem 0.5rem;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
    .chat-none { margin: auto; padding: 0.6rem 0; font-size: 0.78rem; color: #9a9a9a; }
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
    .chat-turn { margin-top: 0.35rem; }

    /* A question that passed between you: where it is from, how it starts,
       and what became of it. */
    .chat-q {
      align-self: flex-start;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      width: 86%;
      padding: 0.45rem 0.6rem 0.5rem;
      border: 1px solid #dcd6ee;
      border-left: 3px solid #c5bee0;
      border-radius: 8px;
      background: #fbf9fe;
      color: #14111a;
      text-decoration: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .chat-q.mine { align-self: flex-end; border-left: 1px solid #dcd6ee; border-right: 3px solid #5c4f7a; }
    .chat-q:hover { border-color: #5c4f7a; box-shadow: 0 3px 12px rgba(92,79,122,0.12); }
    .chat-q-top { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; font-size: 0.68rem; color: #5c4f7a; }
    .chat-q-lec { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat-q-n { flex-shrink: 0; opacity: 0.7; }
    .chat-q-stem {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      font-size: 0.76rem;
      line-height: 1.4;
    }
    .chat-q-stem:empty { display: none; }
    .chat-q-state {
      align-self: flex-start;
      margin-top: 0.1rem;
      padding: 0 0.4rem;
      border: 1px solid #c5bee0;
      border-radius: 4px;
      font-size: 0.66rem;
      color: #5c4f7a;
    }
    .chat-q-state:empty { display: none; }
    .chat-q-state.right { background: #edf7f1; border-color: #2e7d4f; color: #2e7d4f; }
    .chat-q-state.wrong { background: #fdf0f0; border-color: #b03030; color: #b03030; }
    .chat-rest { align-self: flex-start; margin: 0 0.3rem; font-size: 0.7rem; color: #5c4f7a; text-decoration: none; }
    .chat-rest.mine { align-self: flex-end; }
    .chat-rest:hover { text-decoration: underline; }
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
    .chat-box textarea:disabled { background: #efefef; border-color: #e0e0e0; }
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
  // Today by the clock, any other day by its date.
  const whenOf = t => !t ? '' : new Date(t).toDateString() === new Date().toDateString() ? timeOf(t)
    : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase();
  const count = n => `${n} question${n === 1 ? '' : 's'}`;
  const SHOWN = 3;   // question cards in one go before the rest are counted

  // Where a question is from and how it starts, by its short id:
  // { lec, n, stem, doc, id }. Asked for once each.
  const known = {};
  let whereP = null;
  const files = {};
  async function learn(ids) {
    ids = ids.filter(id => !(id in known));
    if (!ids.length) return false;
    ids.forEach(id => { known[id] = null; });
    try {
      const where = await (whereP || (whereP = fetch(`qids.json?t=${Date.now()}`).then(r => r.json())));
      await Promise.all(Object.keys(where).filter(f => where[f].some(id => ids.includes(id))).map(async f => {
        const data = await (files[f] || (files[f] = fetch(f).then(r => r.json())));
        const cut = f.indexOf('/'), qs = data.questions.filter(q => q.id);
        where[f].forEach((id, i) => {
          if (qs[i] && ids.includes(id)) {
            known[id] = { lec: data.lecture || f.slice(cut + 1), n: i + 1, stem: String(qs[i].question || ''),
              doc: STORE.docId(f.slice(0, cut), f.slice(cut + 1)), id: qs[i].id };
          }
        });
      }));
    } catch (e) {}
    return true;
  }

  function mount(el, opts) {
    opts = opts || {};
    el.classList.add('chat');
    el.innerHTML =
      `<div class="chat-head card-head"><button type="button" class="chat-back" hidden>←</button>` +
        `<span class="chat-title">chat</span><span class="chat-with" hidden></span>` +
        `${opts.fold ? '<button type="button" class="week-shuffle" data-fold>hide</button>' : ''}</div>` +
      `<div class="chat-people"><span class="chat-none">…</span></div>` +
      `<div class="chat-thread" hidden><div class="chat-log"></div>` +
        `<form class="chat-box">` +
          `<textarea rows="1" placeholder="message" aria-label="message"></textarea>` +
          `<button type="submit" class="chat-send" disabled>send</button></form></div>`;
    const $ = sel => el.querySelector(sel);
    const peopleEl = $('.chat-people'), threadEl = $('.chat-thread'), log = $('.chat-log');
    const box = $('textarea'), sendBtn = $('.chat-send');

    let people = null;      // everyone else: [{ uid, name }]; null until known
    const meta = {};        // uid -> where the talk with them stands
    let sent = [], inbox = [], receipts = [];   // the questions that have passed
    let open = null;        // whose thread is showing; nobody's until one is picked
    let msgs = null;        // what has been said with them; null until known
    let failed = false;     // their messages can't be read
    let stopThread = null;

    // Everything that has passed between you and this person, oldest first:
    // the questions sent either way, and what was said.
    function passed(uid) {
      const out = [];
      sent.filter(m => m.to === uid).forEach(m => out.push({ t: m.t || 0, mine: true, qids: clean(m.qids), sent: true }));
      // One sent before sends were noted shows once they have opened it.
      const noted = new Set(out.flatMap(m => m.qids));
      receipts.filter(r => r.from === uid && !noted.has(r.qid) && (r.opened || r.done))
        .forEach(r => out.push({ t: Math.min(r.opened || r.done, r.done || r.opened), mine: true, qids: [r.qid], sent: true }));
      inbox.filter(m => m.from === uid).forEach(m => out.push({ t: m.t || 0, mine: false, qids: clean(m.qids), sent: true }));
      if (uid === open) (msgs || []).forEach(m => out.push({ t: m.t || 0, mine: m.mine, qids: clean(m.qids), text: m.text || '' }));
      return out.sort((a, b) => a.t - b.t);
    }

    // What became of a question sent at `t`: for one of yours, what they did
    // with it; for one of theirs, what you did.
    function stateOf(uid, id, item) {
      if (!item.sent) return '';
      if (item.mine) {
        const r = receipts.find(x => x.from === uid && x.qid === id) || {};
        if (r.done && r.done >= item.t) return r.ok ? 'right' : 'wrong';
        return r.opened && r.opened >= item.t ? 'opened' : 'sent';
      }
      const k = known[id];
      const since = k ? STORE.attempts(k.doc, k.id).filter(a => a.t >= item.t).sort((a, b) => a.t - b.t) : [];
      return !since.length ? 'to do' : since[0].ok ? 'right' : 'wrong';
    }

    function paintPeople() {
      if (!people) return;
      if (!people.length) { peopleEl.innerHTML = '<span class="chat-none">no one else yet</span>'; return; }
      const rows = people.map(p => {
        const all = passed(p.uid), q = all[all.length - 1], m = meta[p.uid] || {};
        // The last thing either of you did: said something, or sent questions.
        const said = m.t && (!q || m.t >= q.t);
        const last = said ? (m.text ? `${m.mine ? 'you: ' : ''}${m.text}` : m.mine ? 'you sent a question' : 'sent you a question')
          : q ? (q.mine ? `you sent ${count(q.qids.length)}` : `sent you ${count(q.qids.length)}`) : '';
        return { p, t: Math.max(m.t || 0, q ? q.t : 0), last, unread: !!m.unread };
      }).sort((a, b) => b.t - a.t || a.p.name.localeCompare(b.p.name));
      peopleEl.innerHTML = rows.map(r =>
        `<button type="button" class="chat-person" data-uid="${esc(r.p.uid)}">` +
          `<span class="chat-name">${esc(r.p.name)}</span><span class="chat-at">${esc(whenOf(r.t))}</span>` +
          `<span class="chat-last">${esc(r.last)}</span>${r.unread ? '<i class="chat-dot" title="unread"></i>' : ''}</button>`).join('');
    }

    function ready() {
      box.disabled = !open || failed || !msgs;
      sendBtn.disabled = box.disabled || !box.value.trim();
    }

    function card(uid, id, item) {
      const k = known[id], state = stateOf(uid, id, item);
      return `<a class="chat-q${item.mine ? ' mine' : ''}" href="quiz.html?q=${id}">` +
        `<span class="chat-q-top"><span class="chat-q-lec">${esc(k ? k.lec : id)}</span>` +
          `${k ? `<span class="chat-q-n">q ${k.n}</span>` : ''}</span>` +
        `<span class="chat-q-stem">${esc(k ? k.stem : '')}</span>` +
        `<span class="chat-q-state ${state === 'right' || state === 'wrong' ? state : ''}">${state}</span></a>`;
    }

    function paintLog(stay) {
      if (!open) return;
      const uid = open, all = passed(uid);
      learn(all.flatMap(x => x.qids)).then(fresh => { if (fresh && open === uid) paintLog(true); });
      const note = failed ? "can't load messages" : !msgs ? '…' : !all.length ? 'no messages yet' : '';
      const pinned = !stay || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      const seen = (meta[uid] || {}).seen || 0;
      let html = '', day = '';
      all.forEach((m, i) => {
        const d = dayOf(m.t), prev = all[i - 1], next = all[i + 1];
        if (d !== day) { day = d; html += `<div class="chat-day">${esc(d)}</div>`; }
        const side = m.mine ? ' mine' : '';
        const turn = !prev || prev.mine !== m.mine || dayOf(prev.t) !== d;
        if (turn && prev) html += `<div class="chat-turn"></div>`;
        html += m.qids.slice(0, SHOWN).map(id => card(uid, id, m)).join('');
        if (m.qids.length > SHOWN) {
          html += `<a class="chat-rest${side}" href="quiz.html?q=${m.qids.join(',')}">and ${m.qids.length - SHOWN} more</a>`;
        }
        if (m.text) html += `<div class="chat-msg${side}">${esc(m.text)}</div>`;
        // The time goes under the last of a run, and "seen" under the last thing you said.
        const last = !next || next.mine !== m.mine || next.t - m.t > 5 * 60000;
        if (last) {
          html += `<div class="chat-when${side}">${esc(timeOf(m.t))}` +
            `${m.mine && !next && !m.sent && seen >= m.t ? ', seen' : ''}</div>`;
        }
      });
      log.innerHTML = html + (note ? `<span class="chat-none">${esc(note)}</span>` : '');
      if (pinned) log.scrollTop = log.scrollHeight;
    }

    function show() {
      const who = (people || []).find(p => p.uid === open);
      $('.chat-back').hidden = $('.chat-with').hidden = threadEl.hidden = !who;
      $('.chat-title').hidden = peopleEl.hidden = !!who;
      $('.chat-with').textContent = who ? who.name : '';
    }

    function pick(uid) {
      if (uid === open || !(people || []).some(p => p.uid === uid)) return;
      if (stopThread) stopThread();
      open = uid; msgs = null; failed = false;
      show(); paintLog(); ready();
      stopThread = STORE.watchThread(uid, list => {
        if (open !== uid) return;
        const first = !msgs;
        failed = !list; msgs = list || [];
        paintLog(!first); ready();
        if ((meta[uid] || {}).unread) STORE.readChat(uid);
      });
    }

    // Back to everyone.
    function leave() {
      if (stopThread) stopThread();
      stopThread = null; open = null; msgs = null; failed = false;
      show(); paintPeople();
    }

    $('.chat-back').addEventListener('click', leave);

    peopleEl.addEventListener('click', e => {
      const b = e.target.closest('[data-uid]');
      if (b) { pick(b.dataset.uid); if (!box.disabled) box.focus(); }
    });

    const fit = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight + 2, 120)}px`; };
    box.addEventListener('input', () => { fit(); ready(); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('.chat-box').requestSubmit(); }
    });

    $('.chat-box').addEventListener('submit', async e => {
      e.preventDefault();
      const text = box.value.trim();
      if (!open || box.disabled || !text) return;
      box.value = ''; fit(); ready();
      if (!await STORE.say(open, text)) {
        box.value = text; fit(); ready();
        SHARE.flash(sendBtn, 'not sent');
      }
    });

    // The questions that have passed, asked for again whenever some are sent.
    async function fetchPassed() {
      [sent, inbox, receipts] = await Promise.all([STORE.sent(15000), STORE.inbox(15000), STORE.receipts(15000)]);
      paintPeople();
      if (open) paintLog(true);
    }
    document.addEventListener('jeff-sent', fetchPassed);

    (async () => {
      const [list] = await Promise.all([STORE.people(15000), fetchPassed()]);
      if (!list) { peopleEl.innerHTML = `<span class="chat-none">can't load chat</span>`; return; }
      people = list;
      paintPeople();
      people.forEach(p => STORE.watchChat(p.uid, m => {
        if (!m) return;
        meta[p.uid] = m;
        if (opts.onUnread) opts.onUnread(Object.values(meta).filter(x => x.unread).length);
        if (p.uid !== open) return paintPeople();
        if (m.unread) STORE.readChat(p.uid);
        if (msgs) paintLog(true);
      }));
    })();

    ready();
    return { back: leave };
  }

  window.CHAT = { mount };
})();
