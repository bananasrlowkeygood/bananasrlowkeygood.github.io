#!/usr/bin/env python3
"""Write each block's index.json: its lecture files, their names, question
counts, and the notes and slides that go with each. Also write qids.json:
every question's short id, by the lecture it is in.

The site reads this instead of asking the GitHub API to list a block, so it
never trips the API's per-IP rate limit. Run it after adding or changing a
lecture or a PDF; .github/workflows/jeff-index.yml does so on every push.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
PDFS = ROOT.parent / "pdfs"
MANIFESTS = {"index.json", "weeks.json", "gate.json"}

# Words that say nothing about which lecture a file belongs to.
FILLER = {"and", "of", "the", "to", "a", "in"}
ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}


def words(text):
    # Letters and digits are separate words, so PelvicVisceraPart1 ends in the word 1.
    text = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", text.lower())
    return [ROMAN.get(w, w) for w in re.split(r"[^a-z0-9]+", text) if w and w not in FILLER]


def kind(stem):
    """What a PDF is, from how its name ends: notes, slides, ..."""
    low = stem.lower()
    for mark, label in (("notes", "notes"), ("narrative", "notes"), ("slides", "slides"), ("los", "objectives"),
                        ("answer", "answers"), ("vignettes", "cases")):
        if mark in low:
            return label
    return "handout"


def pdfs_for(slug, files):
    """The PDFs whose names carry every word of the lecture's.

    PDFs are named <date>-<course>_<Lecture-Title>_<lecturer>_<Kind>-<hash>.pdf,
    so the title's words are in there somewhere. Numbers must match a whole
    word (week 1 is not week 10); other words may run together (HistologyLab).
    """
    want = words(slug)
    found = []
    for f in files:
        stem = re.sub(r"-[0-9a-f]{10}$", "", f.stem)           # the content hash
        stem = re.sub(r"^\d{2}\.\d{2}\.\d{2,4}[-_]*", "", stem)  # the date
        have, run = words(stem), "".join(words(stem))
        if all(w in have if w.isdigit() else w in run for w in want):
            found.append({"label": kind(stem), "file": f.name})
    order = ["notes", "slides", "objectives", "cases", "answers", "handout"]
    return sorted(found, key=lambda p: (order.index(p["label"]), p["file"]))


def qid(text):
    """A question's short id, from its long one. quiz.html computes the same."""
    h = 5381
    for ch in text:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    # Stir it, so neighbouring questions do not get near-identical ids.
    h = ((h ^ (h >> 16)) * 0x45D9F3B) & 0xFFFFFFFF
    h ^= h >> 16
    out = ""
    while h:
        h, r = divmod(h, 36)
        out = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + out
    return out or "0"


pdf_files = sorted(PDFS.glob("*.pdf")) if PDFS.is_dir() else []
qids = {}     # 'block/file.json' -> its questions' short ids
owner = {}    # short id -> the long id it came from, to catch two that collide

for block in sorted(p for p in ROOT.iterdir() if p.is_dir()):
    files = sorted(f for f in block.glob("*.json") if f.name not in MANIFESTS)
    if not files:
        continue
    lectures = []
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        entry = {
            "file": f.name,
            "name": data.get("lecture") or f.name,
            "count": len(data.get("questions") or []),
        }
        # A lecture may name its PDFs itself, for files whose names do not carry its title.
        pdfs = data.get("pdfs") or pdfs_for(f.stem, pdf_files)
        ids = [q["id"] for q in data.get("questions") or [] if q.get("id")]
        for i in ids:
            if owner.setdefault(qid(i), i) != i:
                raise SystemExit(f"{i} and {owner[qid(i)]} share the short id {qid(i)}; rename one")
        qids[f"{block.name}/{f.name}"] = [qid(i) for i in ids]
        if pdfs:
            entry["pdfs"] = pdfs
        lectures.append(entry)
    out = {"block": block.name, "lectures": lectures}
    (block / "index.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{block.name}: {len(lectures)} lectures, {sum(1 for l in lectures if 'pdfs' in l)} with PDFs")

(ROOT / "qids.json").write_text(json.dumps(qids, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"qids: {len(owner)} questions")
