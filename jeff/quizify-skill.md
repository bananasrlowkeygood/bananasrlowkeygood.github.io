---
name: quizify
description: >
  Generate Step 1-style USMLE questions from uploaded lecture PDFs, slides, or notes and save them
  as a JSON file to Downloads. Trigger whenever the user uploads medical study material and asks
  for questions, quizzes, or to "quizify" content. Also trigger for "Step 1 questions",
  "board-style questions", "add to jeff", or "add to question bank".
  Infers the lecture name and block (neuro, endorepro, msk) from the content and writes a JSON
  file to ~/Downloads/jeff/{block}/{slug}.json (plus any images under images/{slug}/) — the exact
  paths needed for manual upload to the repo.
---

# Quizify — Jeff Question Bank

Convert uploaded lecture material into Step 1 USMLE questions and save the JSON file to Downloads.

---

## Step 1: Read the Uploaded Files

Read every uploaded file completely before writing a single question. Use:

| Format      | Method                                      |
|-------------|---------------------------------------------|
| `.pdf`      | `pdftotext file.pdf -` or Read tool         |
| Images      | Already in context as vision                |

Do not truncate. Quiz quality depends on full coverage of the material.

---

## Step 2: Infer Lecture Name and Block

From the content, infer:

**Lecture name** — The specific lecture title. Look for the title slide or section header.

**Block** — Map the topic to one of these three folders:

| Block folder  | Topics |
|---------------|--------|
| `neuro`       | Neurology, neuroscience, psychiatry, ophthalmology, ENT |
| `endorepro`   | Endocrinology, reproductive, OB/GYN, renal, fluid/electrolytes |
| `msk`         | Musculoskeletal, orthopedics, rheumatology, dermatology |

If ambiguous, pick the best match and proceed. If truly unclear, ask the user.

**Slug** — Convert the lecture name to lowercase with hyphens: "Thyroid Disorders" → `thyroid-disorders`

---

## Step 3: Write 20 Step 1-Quality Questions

### Format

Each question uses exactly **5 answer choices (A–E)**. Output as a JSON array — do not render a React component.

### The NBME Vignette Formula

```
[Patient demographics + presenting context]
[2–4 relevant clinical findings or history]
[Key lab value, vital sign, or exam finding — the pivot clue]
[Lead-in question ending in a question mark]
```

### Core Principles

**1. Test application, not recall.**
Bad: "What is the MOA of metformin?"
Good: "A 58-year-old woman with T2DM starts a new medication. After 2 months her HbA1c is 6.8% (was 8.4%) and she has lost 2 kg. Creatinine is 1.0 mg/dL. Which mechanism best explains her glycemic improvement?"

**2. Include a pivot clue.** One specific detail (lab value, timing, age, exposure) that determines the correct answer over the distractors. Not a red herring.

**3. Homogeneous distractors.** All 5 choices must be the same category (all diagnoses, all drugs, all mechanisms, all next steps). Never mix.

**4. Parallel length.** All 5 choices roughly the same length. Correct answer must not be the longest.

**5. Second-order reasoning.** Prefer: "X → Y → what is Z?" over "what is X?"

**6. Alphabetize A–E** by the first word of each choice.

### When to Include a Table

Include a `"table"` field when the question references **lab values, vitals panels, CSF results, CBC, BMP, LFTs, or any structured data**. This renders as a compact table in the quiz UI below the question text.

Table format — first row is headers:
```json
"table": [
  ["Test", "Value", "Reference Range"],
  ["Na+", "128 mEq/L", "135–145 mEq/L"],
  ["K+", "6.1 mEq/L", "3.5–5.0 mEq/L"],
  ["Creatinine", "3.2 mg/dL", "0.6–1.2 mg/dL"]
]
```

Use tables for at least 3–4 questions per set where clinically appropriate (lab interpretation questions, management questions where values drive decision-making).

### When to Include an Image

Most questions need no image. Add one only when seeing something is the point of the question or makes the answer clearer: histology, gross pathology, imaging (X-ray, CT, MRI), skin or eye findings, peripheral smears, ECGs, or an anatomy or pathway diagram from the lecture. Lab values go in a `"table"`, never an image. There is no quota; a set with no images is fine.

Two optional fields, each a path or an object:

```json
"image": { "src": "images/{slug}/003.jpg", "caption": "Thyroid biopsy, H&E", "credit": "Slides p. 14" },
"explanationImage": { "src": "images/{slug}/003-exp.png", "caption": "Papillary architecture with Orphan Annie nuclei", "credit": "Wikimedia Commons, CC BY-SA 4.0" }
```

- `image` shows under the stem. Its caption must not give the answer away ("Biopsy of the nodule, H&E", not "Papillary carcinoma").
- `explanationImage` shows under the explanations once the question is answered. Use it when showing the picture earlier would give away the answer, or for a labelled diagram that explains the mechanism.
- `src` is relative to the block folder, so it always starts `images/{slug}/`. `caption` and `credit` are optional; always give `credit` (the slide page, or the source and license for web images).

**Where to get the image, in this order:**

1. **The lecture PDFs.** List the embedded images with `pdfimages -list file.pdf`, (images the size of the whole page are usually the slide template's background; skip them), then pull one page's images with `pdfimages -png -f N -l N file.pdf <dir>/p`. Slide images are often split into pieces or carry masks; if so, render just that region of the page instead: `pdftoppm -png -r 200 -f N -l N -x X -y Y -W W -H H file.pdf <dir>/crop` (pixels at 200 dpi). Crop out slide titles and labels that name the answer.
2. **The web**, when the lecture has no suitable picture. Prefer Wikimedia Commons and other openly licensed sources (CC BY, CC BY-SA, public domain); note the license in `credit`. Download the original file with `curl -L` into a new, empty directory, and check it is an image with `file`.

**Before using any image, open it with the Read tool and confirm it shows what the question says it shows.** Wrong or ambiguous images are worse than none.

**Size.** Shrink to at most 1200 px on the long side: `sips -Z 1200 in.png --out out.png`. Save photos (histology, imaging, skin) as JPEG (`sips -s format jpeg -s formatOptions 80 in.png --out out.jpg`) and diagrams as PNG. Aim for under 300 KB each.

**Naming.** `{NNN}.jpg` or `{NNN}.png` after the question number (`003.jpg`), with `-exp` for an explanation image (`003-exp.png`).

### Per-Question Explanation

Each choice gets its own explanation:
- **Correct**: one sentence explaining the mechanism or reasoning
- **Each wrong choice**: one sentence explaining why it is incorrect — explain what it would actually indicate, not just "this is wrong"

---

## Step 4: Assemble the JSON File

```json
{
  "lecture": "Human-readable lecture name",
  "block": "neuro",
  "generated": "YYYY-MM-DD",
  "questions": [
    {
      "id": "{block}-{slug}-001",
      "question": "Full vignette question stem ending with a question mark",
      "table": [["Col1", "Col2", "Col3"], ["row1a", "row1b", "row1c"]],
      "image": { "src": "images/{slug}/001.jpg", "caption": "Neutral description", "credit": "Slides p. 7" },
      "answers": {
        "A": "First choice",
        "B": "Second choice",
        "C": "Third choice",
        "D": "Fourth choice",
        "E": "Fifth choice"
      },
      "correct": "B",
      "explanations": {
        "A": "Why A is wrong...",
        "B": "Why B is correct...",
        "C": "Why C is wrong...",
        "D": "Why D is wrong...",
        "E": "Why E is wrong..."
      }
    }
  ]
}
```

**Omit `"table"`, `"image"` and `"explanationImage"` entirely for questions that do not use them.** Do not include them as null or empty.

Use today's date (`date +%Y-%m-%d`) for the `generated` field.

---

## Step 5: Save File to Downloads

Create the directory and write the JSON file to the path that matches the repo structure exactly, so it can be uploaded without renaming:

```bash
mkdir -p ~/Downloads/jeff/{block}
# Write JSON to:
~/Downloads/jeff/{block}/{slug}.json
# Images, if any, to:
~/Downloads/jeff/{block}/images/{slug}/
```

Report back: lecture name inferred, block assigned, number of questions written, how many have images and where each came from, and the full file path saved. If there are images, say to upload the `images` folder along with the JSON (both go in the repo's `jeff/{block}/`).

---

## Quality Checklist

Before saving, verify each question:

- [ ] Vignette has age, sex, and at least 2 clinical details
- [ ] Lead-in ends with a question mark
- [ ] Exactly 5 choices, A through E
- [ ] All choices are the same category
- [ ] Choices are alphabetized by first word
- [ ] Choices are roughly equal length
- [ ] Correct answer is not systematically the longest
- [ ] Tests reasoning, not pure recall
- [ ] Explanation covers all 5 choices individually
- [ ] Table included where lab values are referenced
- [ ] Any image was opened and checked, its caption does not give the answer away, and its file is saved under `images/{slug}/`
