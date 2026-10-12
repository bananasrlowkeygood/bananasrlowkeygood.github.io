# jeff

A question bank: Step 1-style questions per lecture, grouped by block and week.

## How it keeps track

- **Attempts.** Every answer you submit is kept with its date: what you picked and whether it was right. They show as chips above the question, oldest first. Before you answer, a chip shows only the date and right/wrong; the letter appears once you have answered. Attempts are never deleted by a reset, a restart or a refine.
- **Marks.** Flags and highlights belong to the question, not the run, so they also survive resets.
- **Runs.** Where you are in a quiz (order, position, answers on screen). One per lecture, week shuffle or block shuffle.
- **Refine** turns the questions you missed into a redo, cleared to answer cold. The rest keep their answers: the `redo / all` switch in the question rail moves between the two without clearing anything.
- The home page shows, per lecture, `tried/total · % right on the last try`.

Everything is saved in the browser first. Signed in, it is also saved to your account and merged on load, so it follows you between devices and survives clearing the browser. Answers made offline go up the next time the page loads with a connection. Two devices open on the same quiz at once: the attempts from both are kept, but the run position is whichever saved last.

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
