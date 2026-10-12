/* ── The store ──
 *
 * Everything a person has done, in three kinds:
 *
 *   attempts  every answer ever submitted to a question — what was picked,
 *             whether it was right, and when. Only ever added to.
 *   marks     the flag and the highlights on a question. Notes rather than
 *             answers, so they outlive any reset.
 *   runs      where you are in a quiz right now: the order, the position and
 *             the answers on screen. One per quiz, replaced as you go.
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
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* full or blocked */ }
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

  // A lecture's history: { a: { questionId: [{ p, ok, t }] },
  //                        m: { questionId: { f, h, t } } }
  // `h` is the highlights as a JSON string, so a Firestore merge replaces them
  // whole instead of leaving removed ones behind.
  const shape = d => ({ a: (d && d.a) || {}, m: (d && d.m) || {} });

  let cache = {};
  const hist = id => cache[id] || (cache[id] = shape(read(hKey(id))));
  const keep = id => write(hKey(id), hist(id));

  const same = (x, y) => x.t === y.t && x.p === y.p;

  // What `mine` holds that `theirs` doesn't.
  function ahead(mine, theirs) {
    const a = {}, m = {};
    Object.keys(mine.a).forEach(q => {
      const have = theirs.a[q] || [];
      const extra = mine.a[q].filter(x => !have.some(y => same(x, y)));
      if (extra.length) a[q] = extra;
    });
    Object.keys(mine.m).forEach(q => {
      if (!theirs.m[q] || (theirs.m[q].t || 0) < (mine.m[q].t || 0)) m[q] = mine.m[q];
    });
    return { a, m };
  }

  const empty = patch => !Object.keys(patch.a).length && !Object.keys(patch.m).length;

  function absorb(into, patch) {
    Object.keys(patch.a).forEach(q => { into.a[q] = (into.a[q] || []).concat(patch.a[q]); });
    Object.keys(patch.m).forEach(q => { into.m[q] = patch.m[q]; });
  }

  function send(id, patch) {
    return cloud.then(c => {
      if (!c || c.uid !== ns) return;
      const data = {};
      if (Object.keys(patch.a).length) {
        data.a = {};
        Object.keys(patch.a).forEach(q => { data.a[q] = c.fs.arrayUnion(...patch.a[q]); });
      }
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
    keysUnder('jeff-run:local:').forEach(k => {
      const mine = rKey(k.slice('jeff-run:local:'.length));
      const run = read(k);
      if (run && !read(mine)) write(mine, run);
      try { localStorage.removeItem(k); } catch (e) {}
    });
  }

  // ── Runs ──
  const pending = {};   // run key -> { updated, state } not yet in Firestore
  const last = {};      // run key -> the JSON last saved, to skip no-op saves
  let timer = null;

  function flushRuns() {
    clearTimeout(timer);
    timer = null;
    const batch = Object.keys(pending).map(key => [key, pending[key]]);
    batch.forEach(([key]) => delete pending[key]);
    if (!batch.length) return;
    cloud.then(c => {
      if (!c || c.uid !== ns) return;
      batch.forEach(([key, run]) => {
        c.fs.setDoc(c.fs.doc(c.db, 'users', c.uid, 'runs', key),
                    { updated: run.updated, state: JSON.stringify(run.state) }).catch(() => {});
      });
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
      if (user) adopt();
    },

    // The document a question's history is filed in.
    docId(block, file) {
      return `${block}__${String(file || '').replace(/\.json$/, '')}`.replace(/[^\w.-]/g, '_');
    },

    // A run's key, from the same things that name it in the URL.
    runId(block, lecture, week) {
      const tail = lecture ? lecture.replace(/\.json$/, '') : week ? 'week-' + week : 'all';
      return `${block}__${tail}`.replace(/[^\w.-]/g, '_');
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
      return (hist(id).a[qid] || []).slice().sort((x, y) => x.t - y.t);
    },

    addAttempt(id, qid, picked, ok, t) {
      const entry = { p: picked, ok: !!ok, t: t === undefined ? Date.now() : t };
      const h = hist(id);
      const list = h.a[qid] || (h.a[qid] = []);
      if (list.some(x => same(x, entry))) return;
      list.push(entry);
      keep(id);
      send(id, { a: { [qid]: [entry] }, m: {} });
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
      send(id, { a: {}, m: { [qid]: next } });
    },

    // How a lecture stands: questions tried, and how many of those were right
    // the last time.
    stats(id) {
      const a = hist(id).a;
      let seen = 0, right = 0;
      Object.keys(a).forEach(q => {
        if (!a[q].length) return;
        seen++;
        if (a[q].reduce((x, y) => (y.t >= x.t ? y : x)).ok) right++;
      });
      return { seen, right };
    },

    readRun(key) {
      const run = read(rKey(key));
      return run && run.state ? run.state : null;
    },

    // Saved on the device at once, and sent to Firestore a moment later so a
    // burst of clicks is one write. Saving the same state twice is a no-op,
    // so just opening a quiz never makes this device's copy look newer.
    saveRun(key, state) {
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
      if (!timer) timer = setTimeout(flushRuns, 2500);
    },

    // Take Firestore's copy of a run if it is newer than this device's.
    pullRun(key, ms) {
      const work = cloud.then(async c => {
        if (!c || c.uid !== ns) return false;
        const snap = await c.fs.getDoc(c.fs.doc(c.db, 'users', c.uid, 'runs', key));
        if (!snap.exists()) return false;
        const remote = snap.data();
        const local = read(rKey(key));
        if (local && (local.updated || 0) >= (remote.updated || 0)) return false;
        write(rKey(key), { updated: remote.updated, state: JSON.parse(remote.state) });
        delete last[key];
        return true;
      }).catch(() => false);
      return within(work, ms);
    }
  };
})();
