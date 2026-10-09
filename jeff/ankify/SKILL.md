---
name: ankify
description: >
  Turn a lecture's Slides PDF (plus its Notes PDF) into PDF Occlusion cards for Anki, boxed the
  way Ravi boxes them by hand. Trigger when the user gives lecture slides and asks to "ankify",
  make occlusion cards, make PDF occlusion cards, "occlude this lecture", or "add to Anki".
  Decides what to hide on every slide, builds the boxes, and hands them to the PDF Occlusion
  add-on as a saved session the user reviews before pressing Create All Cards.
---

# Ankify — PDF Occlusion cards from a lecture

You are doing the job Ravi otherwise does by hand: opening a lecture's slides in the
**PDF Occlusion** Anki add-on and drawing a box over every fact worth recalling. The result is
not cards. It is a **saved session** of boxes that the add-on loads when Ravi opens the PDF, so they
can look them over, fix any, and press **Create All Cards** themselves. Nothing touches the Anki
collection until they do.

The judgment is yours; the geometry is the script's. `scripts/ankify.py` (next to this file)
renders the slides, lists every line of text with an id, turns your plan into pixel-accurate
boxes, and draws them back onto the slides so you can check your work.

The style guide below was derived from 39 lectures (about 1,200 slides, 4,900 cards) that Ravi
occluded by hand in the Neuro/Psych block. Follow it over your own instincts about what makes a
good flashcard.

---

## Workflow

`ANKIFY` below means `python3 <this skill's folder>/scripts/ankify.py`.

### 1. Find the inputs

- **Slides PDF** (required): the file whose name ends in `_Slides`. This is what gets occluded.
- **Notes PDF** (expected): the matching `_Notes` file. It is attached to the cards and it is
  your guide to what matters. If there is none, say so and carry on.
- In Claude Code the user gives paths, or a folder such as `~/Downloads/ENDO:REPRO`; match Slides
  to Notes by lecture title. In the desktop app the PDFs are uploads.
- Several lectures in one request: do them one at a time, start to finish.

### 2. Extract

```bash
ANKIFY extract "<slides.pdf>" --notes "<notes.pdf>" --work <scratch>/<short-name>
```

This writes `text.md` (every line of every slide as `L3 @x,y | text`; lines marked `(ocr)` were
read out of a figure), `notes.txt` (the notes as text), `pages/page-NNN.png` (the slides) and
`pages.json`. Put the work folder in your scratch space, never beside the PDFs.

### 3. Read everything before boxing anything

1. **The notes, in full** (`<work>/notes.txt`; read it in pieces if it is long). Mark the learning objectives, the
   study questions and their answers, bolded terms, and any place the lecturer says what will
   or will not be tested ("resist the urge to memorize the details").
2. **`text.md`, in full.**
3. **The slides themselves.** Text alone hides the layout. Run `ANKIFY preview <work> --all
   --per-sheet 6` now, before you build anything: with no boxes yet it gives plain contact
   sheets of every slide. Read them all, and open `pages/page-NNN.png` directly for any slide
   with a figure, table, or diagram.

### 4. Write the plan

Write `<work>/plan.json`. Pages are **1-based slide numbers**, as shown in `text.md`.

```json
{
  "deck": "ENDO/REPRO::WK1::Pituitary & Hypothalamus (PHYS)",
  "pages": {
    "4": [
      "endocrine",
      "vestigial (humans)",
      {"hide": "L9-L10"},
      {"hide": "L16,L17,L19"}
    ],
    "6": [
      {"hide": "no direct innervation"},
      {"hide": "median eminence, where arterial blood feeds into anterior pituitary"},
      {"hide": ["short portal system", "posterior and anterior pituitary"]},
      {"hide": {"lines": "L7-L9"}}
    ]
  }
}
```

Each entry in a page's list is **one card**. A card hides one or more targets:

| Target | Meaning |
|---|---|
| `"some words"` | Those exact consecutive words on the slide. Matching ignores case and punctuation at word edges. A phrase that wraps onto a second line becomes one box per line, grouped. |
| `"L9-L10"` or `"L16,L17,L19"` | Whole lines, covered by **one** rectangle. Use for a block of sub-bullets and for figure labels (a two-line label is two `(ocr)` lines). |
| `{"lines": "L3-L6", "each": true}` | Whole lines, one box per line. |
| `{"text": "...", "block": true}` | A phrase, covered by one rectangle instead of one box per line. |
| `{"text": "...", "line": "L7"}` or `"occurrence": 2` | Pick between repeats of the same words. |
| `{"rect": [x, y, w, h]}` | A hand-placed box in `page-NNN.png` pixels. Use for a chart, an image, or a label the script could not read. If your image viewer says it scaled the picture down, scale your numbers back up. |

`{"hide": [a, b, c]}` puts several targets on one card: all are hidden together and revealed
together. A bare target (a string, or one of the `{...}` forms above) is a card hiding just that;
a bare list is a card hiding everything in it.

Things that are easy to get wrong:

- `"L1,L3"` is **one rectangle** stretched over both lines and whatever lies between them.
  `["L1", "L3"]` is **two boxes on one card**. Use the second when something that must stay
  visible sits between the two.
- `(ocr)` lines are numbered top to bottom across the whole figure, so the lines of one label
  are often **not** consecutive. Check the `@x,y` positions and list them (`"L22,L24,L27"`); a
  range such as `"L22-L27"` would swallow the labels in between.
- OCR text may be misspelled or garbled. That does not matter for a line target: only the
  position is used.
- `"line"` and `"occurrence"` combine: `occurrence` counts among the matches left after `line`.
- A token that is only punctuation (a lone `%`, `–`, `→`) is not matched and not boxed. Include a
  neighbouring word, or use a line target, if it has to be covered.
- `rect` numbers come from `pages/page-NNN.png`, never from a preview sheet, which is resized.

Do not set `"mode"`. Ravi uses the add-on's default (hide all, guess one) on every card; of
6,400 boxes, 8 ever changed it.

Work through the lecture ten or so slides at a time. A 60-slide lecture is a long plan; that is
expected.

### 5. Build, look, fix

```bash
ANKIFY build <work> <work>/plan.json
ANKIFY preview <work>
```

`build` refuses to write anything while a phrase cannot be found; fix the plan (usually a typo,
a ligature, or a phrase that crosses into a different text box) and run it again. It also warns
when two cards overlap or when it had to guess between repeats.

Then **read every preview sheet** (`preview/sheet-NN.jpg`). Red boxes are cards of their own;
boxes sharing a colour are one card (the colours repeat and mean nothing beyond that). To look
closer at a few slides, `ANKIFY preview <work> --pages 12,30 --per-sheet 1` writes
`preview/zoom-NN.jpg` without disturbing the full set. This is the step that catches real mistakes. Check that:

- every box covers exactly the words you meant and nothing spills onto the cue beside it,
- no box hides the thing that tells the reviewer which card they are on (the heading, the row label, the
  subject of the sentence),
- figure labels are covered completely, leader lines mostly not,
- nothing sits on a title, a footer, a citation or a logo,
- the slides you skipped are slides Ravi would skip.

Fix the plan and rebuild until the sheets look like something Ravi drew.

### 6. Hand over

**In Claude Code on Ravi's Mac** (the add-on folder exists under
`~/Library/Application Support/Anki2/addons21/`):

```bash
ANKIFY install <work>
```

This saves the session where the add-on looks for it. It backs up any session already there and
refuses outright if cards were already made from that PDF; stop and ask in that case, and
use `--force` only if the user says so.

**In the desktop app** (sandbox, no add-on): run the final build once more with
`--out ~/Downloads/jeff/ankify`, which writes `<slides name>.ankify.json` there. Tell the user to run this once in Terminal, which finds the PDF
by name on the Mac and installs the session:

```bash
python3 ~/Developer/bananasrlowkeygood.github.io/jeff/ankify/scripts/ankify.py install ~/Downloads/jeff/ankify/"<slides name>.ankify.json"
```

### 7. Report

Tell the user, briefly: the deck name you chose, cards and slides covered, which slides you skipped
and why in a phrase, and anything you were unsure of (a slide you could not read, a section you
boxed lightly because the notes play it down). Then the next step, every time:

> Open the Slides PDF in PDF Occlusion and answer **Yes** to "Resume your saved session"
> (**No deletes it**). Check the boxes, then press Create All Cards.

---

## Deck name

`<BLOCK>::WK<n>::<Lecture title> (<THREAD>)`, for example
`ENDO/REPRO::WK1::Regulation of Plasma Glucose (BCM)` or
`NEURO/PSYCH::WK7::Psychotic Disorders (CM)`.

- **Block**: from the folder name (`ENDO:REPRO` is `ENDO/REPRO`) or the `Block:` line of the notes.
- **Thread**: the code in the file name (`10.08.26_PHARM_...` is `PHARM`); joint threads as
  `ANAT/PHYS`. Seen so far: ANAT, BCM, CM, CS, HSS, INIM, PHARM, PHYS.
- **Title**: the lecture's title as the file name gives it, in title case, without the lecturer
  or the date.
- **Week**: from the lecture date. ENDO/REPRO WK1 is 10/5–10/9/2026 and weeks run Monday to
  Friday from there; `jeff/endorepro/weeks.json` in the site repo lists them when it is
  available. If the block or week is not clear, ask rather than guess.

Leave the lecture name alone; it defaults to the PDF's file name, which is what Ravi uses.

---

## Style guide: what Ravi hides, and how

### The one principle

**Hide the answer, leave the question.** Every card must be answerable from what is still
visible: the slide title, the bullet's subject, the row header, the picture the label points
at. Ravi boxes the *predicate* of a statement and leaves its *subject* showing.

- "Ketamine primarily acts on **[NMDA receptors]**"
- "Decreases **[bronchial smooth muscle tone]**"
- "Stroke **[mortality]** is higher (57% vs 44%)"
- "Self-regulation of **[thalamus]**"
- "Comprised of **[GABAergic]** neurons"

A box never starts mid-word and never swallows the verb or label that makes the card askable.

### How much, by kind of lecture

About **70–85% of slides** get at least one card. Across all of Ravi's slides: 38% carry exactly one
card, 32% two to four, 18% five to nine, 12% ten or more. The spread is by kind of slide, not
by mood:

| Lecture type | Cards per slide (median) | Cards per lecture | Character |
|---|---|---|---|
| ANAT, ANAT/PHYS | 5–8 | 250–450 | every label, every attachment/innervation/action |
| PHARM | 2 (16 on summary tables) | 80–150 | drug, class, target, effect, adverse effect |
| BCM | 1–2 | 60–100 | pathway nodes, enzymes, the defect and its consequence |
| CM, neurology with imaging/anatomy | 3–6 | 150–270 | syndromes, localisation, labelled images |
| CM, psychiatry and "soft" clinical | 1 | 60–100 | one card per slide, see below |
| HSS, patient panels | 1 | 15–20 | only the few concrete takeaways |

If your totals land far outside these ranges, you are boxing in a different style from Ravi's.
**When the patterns below and these counts disagree, the counts win: group more.** Outside
figures, tables and pathways, the text on one slide is rarely more than three or four cards.
The usual cause of overshooting is cutting one bullet into several small boxes, or making a
card per bullet where Ravi makes one per heading.

### Patterns

**Figure labels: one card each.** On an anatomy figure, a pathway cartoon or a labelled scan,
every label is its own box and its own card (`"L9-L10"` for a two-line label). Do all of them,
both sides of a bilateral figure included: 13 muscle labels is 13 cards. Leave the leader
lines, the view caption ("Anterior View") and the source credit alone. If a figure's labels are
part of a flattened image and `text.md` shows them as `(ocr)` lines, use those lines; if the
script could not read one, place a `rect`.

**Heading with sub-bullets: hide the sub-bullets as one block.** When a bullet names a thing
and its children describe it, the name stays and the children go under a single rectangle:

- *Longus colli* → **[Cervical vertebrae / C2–C6 spinal nerves / Flexes neck]**
- *Anterior Triangle Boundaries* → **[the four boundary lines]**
- *Trihexyphenidyl (artane)* → **[Mechanism … / Side effects … / Uses …]**

Use a line range (`"L5-L7"`). One block per parent, so a slide of four muscles or four drugs is
four cards. The same goes for labelled sections of a slide: under "CV:" and "Respiratory:", or
"MOA" under each drug class, each section's bullets are one block and one card.

**A list of names under a class is one block.** "Examples of prostaglandin analogs" followed by
four drugs, or "Antifungals" followed by six, is a single card over the whole list, not a card
per drug.

**One bullet, one box.** Do not cut a bullet into several small boxes ("insulin response from"
/ "beta cells" / "glucose-dependent"). Take the whole predicate as one phrase.

**Ask what the slide's title is asking.** The hidden part is the answer to that. On a slide
titled "Side effects" the bolded names of the effects are the answers, so they are hidden and
their descriptions stay as the cue; on a slide titled with the drug's name, the name stays and
its properties are hidden.

**Sentence bullets: hide the key phrase.** One box on the fact: the number, the name, the
direction of change, the cause, the site. Take the whole noun phrase, not a lone word, when the
phrase is the answer ("**[inhibitory signals to the Deep cerebellar nuclei]**").

**A phrase that wraps is still one card.** Give the phrase as one string; the script boxes each
line and groups them. Five of every six groups Ravi made are exactly this, two boxes on two lines.

**Clinical and psych bullet slides: one card for the slide.** On a slide that is a list of
features, statistics or talking points (bradykinesia features; course of schizophrenia; gender
disparities in stroke), Ravi does not make a card per bullet but boxes the key phrase in each
bullet and **groups them all**, or draws one block over the whole list, so the slide is one
card: "what are the features of X?". Write this as one card with several targets:

```json
{"hide": ["slowness of movement", "blink rate", "stride length and arm swing",
          {"lines": "L4-L5"}]}
```

Use two cards when a slide plainly has two halves. Reserve one-card-per-fact for bullets that
are separately testable hard facts: a receptor, a dose threshold, a vessel, a gene.

**Counts with their lists go together.** "External carotid artery has **[8]** branches" plus the
eight branches is a single card hiding the number and the list.

**Definitions: hide the definition.** Leave "General anesthesia is defined as" and box the body.

**Mnemonics and named sets: hide the expansion.** "4 As" stays; **[Autism / Ambivalence /
Associations / Affect]** is one block.

**Tables: one card per answer cell.** Row headers and column headers stay visible; each body
cell (Notes, Function, Location, Lesion…) is its own box. A dense comparison table is
legitimately 15–35 cards. When only one column is the point and it is a simple gradient (fibre
type against sensitivity to block), one box down that whole column is enough. A purely numeric reference table (Phe content of foods) is one box
over the body, or nothing.

**Pathways and flowcharts: box the nodes.** Each intermediate, each enzyme, each drug hanging
off an arrow, each disease named at a block is its own card. Leave arrows and the start/end
products that orient the diagram when they are obvious anchors. In a top-down tree
(embryological vesicles and their derivatives) box every box.

**Charts and graphs: one box, on the message.** Either one rectangle over the plot area with the
title and axes showing, or the legend/key that says what the series are. Never a card per bar.

**Scans and photos: box the caption that names the finding** ("Epidural", "Subdural",
"Intracerebral" over three CTs), each its own card. Do not box the image itself.

**Titles stay.** The one exception is a title that *is* the fact, where only the key
term is boxed ("**[CAG/Polyglutamine]** Repeat Diseases").

**Text and figure on the same slide: do both.** The bullets by the rules above, the labels as
label cards. This is where the 12-to-25-card slides come from.

### What Ravi skips

- Title slide, disclosures, learning objectives, outline/agenda, "Questions?", thank-you,
  references and reading lists.
- Case-vignette and audience-question slides (the *answer* slide that follows may be worth a card).
- Section dividers and slides that are only a photo or a cartoon with nothing to name.
- Progressive builds: when consecutive slides repeat with one more line each, box **only the
  last, complete one**.
- The same figure shown again and again with a different part circled (a guideline algorithm
  revisited for each drug class): box the clearest full-size copy once and leave the repeats.
- Small recurring badges or icons beside titles: at most one card on the slide where the idea
  is introduced.
- End-of-lecture recap slides that repeat earlier slides word for word. (A summary *table* or
  diagram that organises the content is the opposite: often the densest slide in the deck.)
- History, epidemiology colour and anecdotes that the notes do not mention: skip, or fold into
  the slide's single grouped card.

### Using the notes

The notes decide between "hide it" and "leave it":

- Anything in a learning objective, a study question or its answer gets a card, on whichever
  slide states it best.
- Terms the notes bold or define get cards.
- Where the lecturer says the detail is not the point, make one grouped card for the idea, not
  ten for the detail.
- Content on a slide that the notes never mention is the first thing to cut when a slide is
  getting crowded.

Never invent content. You only choose what to hide among what is printed on the slide.

### Mechanics Ravi keeps to

- Plain rectangles only; no ellipses, no rotation.
- Boxes hug the text with a small margin (the script adds it). Do not draw one large box over a
  region with unrelated things in it just to save effort.
- Cards on one slide must not overlap: the add-on hides every box on the question side, but an
  overlap means revealing one card gives away part of another.
- Ravi does not use the per-card note field, per-slide mode overrides, or text annotations.

---

## When things go wrong

- **`text not found`**: copy the words exactly as `text.md` prints them. If a phrase spans two
  separate text boxes on the slide, split it into two targets on the same card.
- **A slide shows no text at all**: it is a flattened image. With OCR available (`ocr: vision`
  on a Mac, `tesseract` elsewhere) re-run `extract --ocr all`; otherwise use `rect` targets and
  check them on the preview.
- **`ocr: none`** (typical in the desktop app's sandbox): figure labels have to be `rect`
  targets placed by eye. Preview one slide per sheet (`--per-sheet 1 --width 1400`) and adjust
  until each label is covered. Say in your report that the label boxes were hand-placed and
  deserve a closer look.
- **No poppler** (`pdftotext`/`pdftoppm` missing): `pip install pypdfium2 pillow` and re-run;
  the script falls back to it. `preview` always needs Pillow.
- **`already has N cards made from it`**: the lecture was done before. Do not force. Ask
  whether the user wants to add to it in the add-on or replace it.
- **The user answered No to "Resume your saved session"**: the add-on deleted the session. Run
  `install` again; the `.ankify.json` is still in the work folder and in `~/Downloads/jeff/ankify`.
