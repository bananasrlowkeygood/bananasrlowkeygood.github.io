/* ── The store ──
 *
 * Everything a person has done, in three kinds:
 *
 *   attempts  every answer submitted to a question — what was picked, whether
 *             it was right, when, and in which test. They go only when the
 *             test they were made in is deleted.
 *   marks     the flag and the highlights on a question. Notes rather than
 *             answers, so they outlive any reset.
 *   tests     one sitting of a quiz: the order, the position and the answers
 *             on screen. An unfinished one is resumed; a finished or
 *             restarted one is kept, and a new one begins. Each also has a
 *             line in the tests index — what it covered, when, the score —
 *             so they can be listed without loading every one.
 *
 * Signed in, there is also an inbox: questions other people sent you, as
 * lists of question ids under users/{uid}/inbox. It lives in Firestore only.
 *
 * All of it is written to this browser first, so the site works signed out,
 * offline, or with no Firebase project at all. When someone is signed in it is
 * also copied to Firestore under users/{uid}, and merged back in on load, so
 * the same history follows them to another device.
 *
 * Attempts and marks are filed one document per lecture, which keeps opening a
 * lecture to a single read.
 */
(function () {
  'use strict';

  let ns = 'local';                    // whose data this is: a uid, or 'local'
  let cloud = Promise.resolve(null);   // -> { db, fs, uid } | null

  const hKey = id => `jeff-h:${ns}:${id}`;
  const rKey = id => `jeff-run:${ns}:${id}`;

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function write(key, value) {
    const body = JSON.stringify(value);
    try { localStorage.setItem(key, body); return; } catch (e) { /* full or blocked */ }
    // Full. Old tests are the bulk of it, and signed in they are in the
    // account too, so let the oldest quarter go and try once more.
    const runs = keysUnder(`jeff-run:${ns}:`).filter(k => k !== key)
      .map(k => [k, (read(k) || {}).updated || 0]).sort((a, b) => a[1] - b[1]);
    runs.slice(0, Math.max(3, runs.length >> 2)).forEach(([k]) => {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    try { localStorage.setItem(key, body); } catch (e) {}
  }
  function keysUnder(prefix) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) out.push(k);
      }
    } catch (e) {}
    return out;
  }

  // A lecture's history: { a: { questionId: [{ p, ok, t, r }] },
  //                        x: { questionId: [{ p, t }] },
  //                        m: { questionId: { f, h, t } } }
  // `r` is the test an attempt was made in. `x` lists attempts since taken
  // back: both lists only ever grow, so two devices can merge them in any
  // order and agree, and what counts is whatever is in `a` and not in `x`.
  // `h` is the highlights as a JSON string, so a Firestore merge replaces them
  // whole instead of leaving removed ones behind.
  const shape = d => ({ a: (d && d.a) || {}, x: (d && d.x) || {}, m: (d && d.m) || {} });

  let cache = {};

  // The tests index: { testId: { scope, q, label, n, right, wrong, done,
  //                             started, updated, ended? } }
  const tKey = () => `jeff-tests:${ns}`;
  let index = null;
  const tests = () => index || (index = read(tKey()) || {});
  const keepTests = () => write(tKey(), tests());
  const hist = id => cache[id] || (cache[id] = shape(read(hKey(id))));
  const keep = id => write(hKey(id), hist(id));

  const same = (x, y) => x.t === y.t && x.p === y.p;

  // A question's attempts that still count.
  function live(h, qid) {
    const gone = h.x[qid] || [];
    return (h.a[qid] || []).filter(a => !gone.some(g => same(a, g)));
  }

  // A question you have missed comes back for review: a day after a miss, then
  // 3 and 7 days after each time in a row you get it right. Three in a row and
  // it is settled. One you have never missed is never due.
  const STEPS = [1, 3, 7];

  function isDue(list, now) {
    if (!list || !list.length) return false;
    const tries = list.slice().sort((x, y) => x.t - y.t);
    let streak = 0;
    while (streak < tries.length && tries[tries.length - 1 - streak].ok) streak++;
    if (streak === tries.length || streak >= STEPS.length) return false;
    const back = new Date(tries[tries.length - 1].t);
    back.setHours(0, 0, 0, 0);
    back.setDate(back.getDate() + STEPS[streak]);
    return back.getTime() <= (now === undefined ? Date.now() : now);
  }

  // What `mine` holds that `theirs` doesn't.
  function ahead(mine, theirs) {
    const a = {}, x = {}, m = {};
    [['a', a], ['x', x]].forEach(([part, out]) => {
      Object.keys(mine[part]).forEach(q => {
        const have = theirs[part][q] || [];
        const extra = mine[part][q].filter(e => !have.some(y => same(e, y)));
        if (extra.length) out[q] = extra;
      });
    });
    Object.keys(mine.m).forEach(q => {
      if (!theirs.m[q] || (theirs.m[q].t || 0) < (mine.m[q].t || 0)) m[q] = mine.m[q];
    });
    return { a, x, m };
  }

  const empty = patch => !Object.keys(patch.a).length && !Object.keys(patch.x).length && !Object.keys(patch.m).length;

  function absorb(into, patch) {
    Object.keys(patch.a).forEach(q => { into.a[q] = (into.a[q] || []).concat(patch.a[q]); });
    Object.keys(patch.x).forEach(q => { into.x[q] = (into.x[q] || []).concat(patch.x[q]); });
    Object.keys(patch.m).forEach(q => { into.m[q] = patch.m[q]; });
  }

  function send(id, patch) {
    return cloud.then(c => {
      if (!c || c.uid !== ns) return;
      const data = {};
      ['a', 'x'].forEach(part => {
        if (!Object.keys(patch[part]).length) return;
        data[part] = {};
        Object.keys(patch[part]).forEach(q => { data[part][q] = c.fs.arrayUnion(...patch[part][q]); });
      });
      if (Object.keys(patch.m).length) data.m = patch.m;
      return c.fs.setDoc(c.fs.doc(c.db, 'users', c.uid, 'lectures', id), data, { merge: true });
    }).catch(() => { /* still on the device; goes up with the next pull */ });
  }

  // Bring a lecture level with its copy in Firestore, in both directions.
  function settle(id, remote) {
    const local = hist(id);
    const up = ahead(local, remote);
    const down = ahead(remote, local);
    if (!empty(down)) { absorb(local, down); keep(id); }
    if (!empty(up)) send(id, up);
  }

  const within = (promise, ms) => Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(undefined), ms))
  ]);

  // Before accounts, and on the shared password, history is filed under
  // 'local'. The first person to sign in on this browser takes it with them.
  function adopt() {
    keysUnder('jeff-h:local:').forEach(k => {
      const id = k.slice('jeff-h:local:'.length);
      const theirs = shape(read(k));
      const patch = ahead(theirs, hist(id));
      if (!empty(patch)) { absorb(hist(id), patch); keep(id); }
      try { localStorage.removeItem(k); } catch (e) {}
    });
    const theirs = read('jeff-tests:local');
    if (theirs) {
      Object.keys(theirs).forEach(id => { if (!tests()[id]) tests()[id] = theirs[id]; });
      keepTests();
      try { localStorage.removeItem('jeff-tests:local'); } catch (e) {}
    }
    keysUnder('jeff-run:local:').forEach(k => {
      const mine = rKey(k.slice('jeff-run:local:'.length));
      const run = read(k);
      if (run && !read(mine)) write(mine, run);
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  // Take back the attempts made in a deleted test. Each attempt names its
  // test; ones from before they did are matched by having been made in the
  // test's lectures while it was open. Safe to run again: nothing is taken
  // back twice.
  function purge(id, line) {
    const q = new URLSearchParams(line.q || '');
    const block = q.get('block') || '';
    const scope = q.get('lecture') ? [docIdOf(block, q.get('lecture'))]
      : q.get('set') ? q.get('set').split(',').map(s => docIdOf(...(s.includes('/') ? s.split('/') : [block, s])))
      : null;   // a week or a whole block: anything in the block
    const inScope = doc => scope ? scope.includes(doc) : doc.startsWith(block + '__');

    keysUnder(`jeff-h:${ns}:`).forEach(k => {
      const doc = k.slice(`jeff-h:${ns}:`.length);
      const h = hist(doc);
      const patch = { a: {}, x: {}, m: {} };
      Object.keys(h.a).forEach(qid => {
        const out = live(h, qid).filter(a => a.r
          ? a.r === id
          : !!(a.t && line.started && a.t >= line.started && a.t <= line.updated && inScope(doc)));
        if (out.length) patch.x[qid] = out.map(a => ({ p: a.p, t: a.t }));
      });
      if (empty(patch)) return;
      absorb(h, patch);
      keep(doc);
      send(doc, patch);
    });
  }

  // Say who you are, so other people can pick you to send questions to.
  // Written once per browser, and again if the name changes.
  let me = null;
  function announce() {
    const key = `jeff-me:${ns}`, name = me.name || '';
    if (!name || read(key) === name) return;
    cloud.then(c => {
      if (!c || c.uid !== ns) return;
      return c.fs.setDoc(c.fs.doc(c.db, 'people', c.uid), { name }).then(() => write(key, name));
    }).catch(() => {});
  }

  const docIdOf = (block, file) =>
    `${block}__${String(file || '').replace(/\.json$/, '')}`.replace(/[^\w.-]/g, '_');

  // ── Tests ──
  const pending = {};     // test id -> { updated, state } not yet in Firestore
  let pendingIndex = {};  // test id -> its index line, likewise
  const last = {};        // test id -> the JSON last saved, to skip no-op saves
  let timer = null;

  const soon = () => { if (!timer) timer = setTimeout(flushRuns, 2500); };

  function flushRuns() {
    clearTimeout(timer);
    timer = null;
    const batch = Object.keys(pending).map(key => [key, pending[key]]);
    batch.forEach(([key]) => delete pending[key]);
    const lines = pendingIndex;
    pendingIndex = {};
    if (!batch.length && !Object.keys(lines).length) return;
    cloud.then(c => {
      if (!c || c.uid !== ns) return;
      batch.forEach(([key, run]) => {
        c.fs.setDoc(c.fs.doc(c.db, 'users', c.uid, 'runs', key),
                    { updated: run.updated, state: JSON.stringify(run.state) }).catch(() => {});
      });
      if (Object.keys(lines).length) {
        c.fs.setDoc(c.fs.doc(c.db, 'users', c.uid, 'index', 'tests'), lines, { merge: true }).catch(() => {});
      }
    });
  }

  // A closing tab doesn't wait for the timer.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushRuns(); });
  window.addEventListener('pagehide', flushRuns);

  window.STORE = {
    // Call once, before anything else, with whoever GATE let in.
    open(user, cloudPromise) {
      ns = user ? user.uid : 'local';
      cloud = cloudPromise || Promise.resolve(null);
      cache = {};
      index = null;
      me = user || null;
      if (user) { adopt(); announce(); }
    },

    // Everyone else who has signed in: [{ uid, name }], by name.
    people(ms) {
      const work = cloud.then(async c => {
        if (!c || c.uid !== ns) return [];
        const snap = await c.fs.getDocs(c.fs.collection(c.db, 'people'));
        return snap.docs.filter(d => d.id !== c.uid)
          .map(d => ({ uid: d.id, name: d.data().name || '' }))
          .filter(p => p.name)
          .sort((a, b) => a.name.localeCompare(b.name));
      }).catch(() => []);
      return within(work, ms).then(list => list || []);
    },

    // Put these questions in someone's inbox. Resolves true once it is there.
    sendTo(uid, qids) {
      return cloud.then(async c => {
        if (!c || c.uid !== ns || !qids.length) return false;
        await c.fs.addDoc(c.fs.collection(c.db, 'users', uid, 'inbox'),
          { from: c.uid, name: (me && me.name) || '', qids: qids.slice(0, 200), t: Date.now() });
        return true;
      }).catch(() => false);
    },

    // What has been sent to you, newest first: [{ id, name, qids, t }].
    inbox(ms) {
      const work = cloud.then(async c => {
        if (!c || c.uid !== ns) return [];
        const snap = await c.fs.getDocs(c.fs.collection(c.db, 'users', c.uid, 'inbox'));
        return snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
          .filter(m => Array.isArray(m.qids) && m.qids.length)
          .sort((a, b) => (b.t || 0) - (a.t || 0));
      }).catch(() => []);
      return within(work, ms).then(list => list || []);
    },

    dropInbox(id) {
      return cloud.then(c => {
        if (c && c.uid === ns) return c.fs.deleteDoc(c.fs.doc(c.db, 'users', c.uid, 'inbox', id));
      }).catch(() => {});
    },

    // Whether the account can be reached: true once the sign-in is confirmed,
    // false when there is nothing to reach (no accounts, or offline), and
    // undefined if it still isn't known after `ms`.
    online(ms) {
      return within(cloud.then(c => !!(c && c.uid === ns), () => false), ms);
    },

    // Send what is waiting now rather than in a moment.
    flush() { flushRuns(); },

    // The document a question's history is filed in.
    docId(block, file) { return docIdOf(block, file); },

    // A run's key: the block, plus whatever names the run within it (a
    // lecture, 'week-2', 'all', a custom set).
    runId(block, tail) {
      return `${block}__${tail}`.replace(/[^\w-]/g, '_');
    },

    // Merge in what Firestore has for these lectures (all of them when `ids`
    // is null). Gives up waiting after `ms` so a slow connection never holds
    // the page; a late answer is still merged, just not waited for.
    pull(ids, ms) {
      const work = cloud.then(async c => {
        if (!c || c.uid !== ns) return false;
        const at = id => c.fs.doc(c.db, 'users', c.uid, 'lectures', id);
        let found;
        if (!ids || ids.length > 10) {
          const snap = await c.fs.getDocs(c.fs.collection(c.db, 'users', c.uid, 'lectures'));
          found = snap.docs.map(d => [d.id, d.data()]);
        } else {
          found = await Promise.all(ids.map(async id => {
            const snap = await c.fs.getDoc(at(id));
            return [id, snap.exists() ? snap.data() : null];
          }));
        }
        const seen = new Set();
        found.forEach(([id, data]) => { seen.add(id); settle(id, shape(data)); });
        // Lectures only this device knows about still need to go up.
        const mine = ids || keysUnder(`jeff-h:${ns}:`).map(k => k.slice(`jeff-h:${ns}:`.length));
        mine.forEach(id => { if (!seen.has(id)) settle(id, shape(null)); });
        return true;
      }).catch(() => false);
      return within(work, ms);
    },

    // Every attempt at a question, oldest first. `t` is 0 for answers carried
    // over from before attempts were dated.
    attempts(id, qid) {
      return live(hist(id), qid).sort((x, y) => x.t - y.t);
    },

    // `test` is the test the answer was given in, so deleting the test can
    // take the answer with it.
    addAttempt(id, qid, picked, ok, t, test) {
      const entry = { p: picked, ok: !!ok, t: t === undefined ? Date.now() : t };
      if (test) entry.r = test;
      const h = hist(id);
      const list = h.a[qid] || (h.a[qid] = []);
      if (list.some(x => same(x, entry))) return;
      list.push(entry);
      keep(id);
      send(id, { a: { [qid]: [entry] }, x: {}, m: {} });
    },

    // { flagged, highlights } for a question, or null if it has neither.
    mark(id, qid) {
      const m = hist(id).m[qid];
      if (!m) return null;
      let highlights = {};
      try { highlights = JSON.parse(m.h || '{}') || {}; } catch (e) {}
      return { flagged: !!m.f, highlights };
    },

    setMark(id, qid, flagged, highlights) {
      const h = hist(id);
      const next = { f: !!flagged, h: JSON.stringify(highlights || {}), t: Date.now() };
      const prev = h.m[qid];
      if (prev ? (prev.f === next.f && prev.h === next.h) : (!next.f && next.h === '{}')) return;
      h.m[qid] = next;
      keep(id);
      send(id, { a: {}, x: {}, m: { [qid]: next } });
    },

    // How a lecture stands: questions tried, how many of those were right
    // the last time, how many are due for review, and how many are flagged.
    stats(id) {
      const h = hist(id), m = h.m;
      let seen = 0, right = 0, due = 0;
      Object.keys(h.a).forEach(q => {
        const tries = live(h, q);
        if (!tries.length) return;
        seen++;
        if (tries.reduce((x, y) => (y.t >= x.t ? y : x)).ok) right++;
        if (isDue(tries)) due++;
      });
      const flagged = Object.keys(m).filter(q => m[q].f).length;
      return { seen, right, due, flagged };
    },

    // Whether a question with these attempts is due for review.
    due(tries) { return isDue(tries); },

    readRun(key) {
      const run = read(rKey(key));
      return run && run.state ? run.state : null;
    },

    // Saved on the device at once, and sent to Firestore a moment later so a
    // burst of clicks is one write. Saving the same state twice is a no-op,
    // so just opening a quiz never makes this device's copy look newer.
    // `line` is the test's entry in the index, rewritten when it changes.
    saveRun(key, state, line) {
      if (line) {
        const prev = Object.assign({}, tests()[key]);
        delete prev.updated;
        // Once put aside, a test stays put aside, even if it is reopened.
        if (prev.ended) line = Object.assign({}, line, { ended: true });
        if (JSON.stringify(prev) !== JSON.stringify(line)) {
          tests()[key] = Object.assign({}, line, { updated: Date.now() });
          keepTests();
          pendingIndex[key] = tests()[key];
          soon();
        }
      }
      const body = JSON.stringify(state);
      if (last[key] === undefined) {
        const prev = read(rKey(key));
        last[key] = prev && prev.state ? JSON.stringify(prev.state) : null;
      }
      if (last[key] === body) return;
      last[key] = body;
      const run = { updated: Date.now(), state };
      write(rKey(key), run);
      pending[key] = run;
      soon();
    },

    // A test's line in the index, or null if it was never saved.
    test(id) {
      const t = tests()[id];
      return t && !t.gone ? t : null;
    },

    // Every test, most recently touched first.
    listTests() {
      return Object.keys(tests()).filter(id => !tests()[id].gone)
        .map(id => Object.assign({ id }, tests()[id]))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },

    // Remove a test for good, and the answers given in it with it. Its line is
    // left as a marker saying so, or another device that still has it would
    // put it straight back — and so that device can drop the answers too.
    deleteTest(id) {
      const was = Object.assign({}, tests()[id], { updated: Date.now() });
      purge(id, was);
      tests()[id] = { gone: true, updated: was.updated, started: was.started, q: was.q };
      keepTests();
      pendingIndex[id] = tests()[id];
      delete pending[id];
      delete last[id];
      try { localStorage.removeItem(rKey(id)); } catch (e) {}
      soon();
      cloud.then(c => {
        if (c && c.uid === ns) return c.fs.deleteDoc(c.fs.doc(c.db, 'users', c.uid, 'runs', id));
      }).catch(() => {});
    },

    // The test to carry on with for a scope: the latest one neither finished
    // nor put aside by a restart.
    openTest(scope) {
      const t = this.listTests().find(x => x.scope === scope && !x.done && !x.ended);
      return t ? t.id : null;
    },

    // Put a test aside so the next visit starts a new one. It stays listed.
    endTest(id) {
      const t = tests()[id];
      if (!t || t.ended) return;
      t.ended = true;
      t.updated = Date.now();
      keepTests();
      pendingIndex[id] = t;
      soon();
    },

    // Level the index with the account's copy; the newer line wins each way.
    pullTests(ms) {
      const work = cloud.then(async c => {
        if (!c || c.uid !== ns) return false;
        const snap = await c.fs.getDoc(c.fs.doc(c.db, 'users', c.uid, 'index', 'tests'));
        const remote = snap.exists() ? snap.data() : {};
        const mine = tests();
        Object.keys(remote).forEach(id => {
          if (!mine[id] || (mine[id].updated || 0) <= (remote[id].updated || 0)) mine[id] = remote[id];
        });
        // A test deleted on another device takes its answers from this one too.
        Object.keys(mine).forEach(id => { if (mine[id].gone) purge(id, mine[id]); });
        Object.keys(mine).forEach(id => {
          if (!remote[id] || (remote[id].updated || 0) < (mine[id].updated || 0)) pendingIndex[id] = mine[id];
        });
        keepTests();
        if (Object.keys(pendingIndex).length) soon();
        return true;
      }).catch(() => false);
      return within(work, ms);
    },

    // Every attempt this device knows of: { docId: { questionId: [tries] } }.
    everything() {
      const out = {};
      keysUnder(`jeff-h:${ns}:`).forEach(k => {
        const id = k.slice(`jeff-h:${ns}:`.length);
        const h = hist(id);
        out[id] = {};
        Object.keys(h.a).forEach(q => { out[id][q] = live(h, q); });
      });
      return out;
    },

    // Level a test with Firestore's copy of it: whichever is newer wins.
    pullRun(key, ms) {
      const work = cloud.then(async c => {
        if (!c || c.uid !== ns) return false;
        const snap = await c.fs.getDoc(c.fs.doc(c.db, 'users', c.uid, 'runs', key));
        const remote = snap.exists() ? snap.data() : null;
        const local = read(rKey(key));
        // This device's copy is the newer one — a save that never got out
        // before the page closed. Send it now.
        if (local && local.state && (!remote || (local.updated || 0) > (remote.updated || 0))) {
          pending[key] = local;
          soon();
          return false;
        }
        if (!remote) return false;
        if (local && (local.updated || 0) >= (remote.updated || 0)) return false;
        write(rKey(key), { updated: remote.updated, state: JSON.parse(remote.state) });
        delete last[key];
        return true;
      }).catch(() => false);
      return within(work, ms);
    }
  };
})();
