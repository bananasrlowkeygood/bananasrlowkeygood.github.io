# jeff

A question bank: Step 1-style questions per lecture, grouped by block and week.

## How it keeps track

- **Attempts.** Every answer you submit is kept with its date: what you picked and whether it was right. They show as chips above the question, oldest first. Before you answer, a chip shows only the date and right/wrong; the letter appears once you have answered. Attempts are never deleted by a reset, a restart or a refine.
- **Marks.** Flags and highlights belong to the question, not the run, so they also survive resets.
- **Tests.** One sitting of a quiz (order, position, answers on screen). Opening a lecture, week, block or custom set carries on with its unfinished test if there is one, and otherwise starts a new one. Finishing every question, or pressing restart, puts the test aside; it stays on the history page, where any test can be reopened as it was left.
- **Refine** turns the questions you missed into a redo, cleared to answer cold. The rest keep their answers: the `redo / all` switch in the question rail moves between the two without clearing anything.
- The home page shows tried/total and % right on the last try per lecture, and the same rolled up per week and block.

## Custom sets

**Custom** turns every lecture into something you tick, across blocks (a week's **select** ticks the whole week). The bar at the bottom shows what the ticked lectures hold and starts the set:

- **all**: every question in them, shuffled.
- **due**: questions due for review (below).
- **missed**: questions you got wrong the last time you tried them.
- **unseen**: questions you have never answered.
- **flagged**: questions you flagged.

A due, missed, unseen or flagged test is a snapshot taken when it starts: it keeps its questions until you finish it, and the next one takes a fresh cut.

## Due for review

A question you get wrong comes back the next day. Each time in a row you then get it right, it comes back later: after 3 days, then after 7. Three right in a row and it is settled; miss it again and it starts over. Questions you have never missed are never due.

When anything is due, **due for review** appears at the top of the home page and opens all of it as one set, across blocks.

## History

**history** (top right of the home page) shows where you stand overall (tried, right on the last try, right on the first try, today, last 7 days, days in a row), your weakest lectures (each opens that lecture's missed questions), tests in progress, and past tests. The × beside a test deletes it (it asks once); the answers given in it stay in each question's history.

Everything is saved in the browser first. Signed in, it is also saved to your account and merged on load, so it follows you between devices and survives clearing the browser. Answers made offline go up the next time the page loads with a connection. Two devices open on the same test at once: the attempts from both are kept, but the position is whichever saved last. If the browser's storage fills up, the oldest tests' details are dropped from that browser first; signed in, they are still in your account.

## Keys

`A`–`E` or `1`–`5` pick · `Enter` submit, then next · `←` `→` move · `S` skip · `F` flag · `H` highlight the selection · right-click a choice to strike it

## Turning accounts on

Until `firebase-config.js` is filled in, the site runs on the shared password and browser-only progress.

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics not needed).
2. **Authentication** (in the left sidebar, under Project shortcuts or Security) **→ Get started → Sign-in method → Google → Enable.**
   Then **Authentication → Settings → Authorized domains → Add** `bananasrlowkeygood.github.io`.
3. **Databases & Storage → Firestore → Create database** (production mode).
   **Rules** tab → paste `firestore.rules` → **Publish**.
4. **Firestore → Data → Start collection** `allowlist`. One document per person, with the document ID set to their Google email in lowercase. The fields don't matter (add `name` if the console wants one).
5. **Project settings → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` object into `firebase-config.js` in place of `null`.

To let someone in, add their email to `allowlist`. To remove them, delete it.

The first time each person signs in, the progress already in that browser is moved into their account.

The questions themselves are public JSON in this repo. Accounts keep each person's history private; they do not hide the questions.

## Adding lectures

Drop the JSON in its block folder and add it to that block's `weeks.json`. `index.json` (the lecture list the site reads) is rebuilt by a GitHub Action on push; to rebuild by hand run `python3 jeff/build_index.py`.
