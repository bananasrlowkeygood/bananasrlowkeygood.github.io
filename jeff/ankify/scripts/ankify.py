#!/usr/bin/env python3
"""ankify: turn a lecture PDF into Anki cards.

Text cards (the default):

  extract  SLIDES.pdf --work DIR       render the slides, list every line of text
  cards    DIR cards.json              check the cloze cards and package them
  install  DIR | FILE.ankify-cards.json  add them to the Anki collection (Anki closed)

Occlusion cards, for the PDF Occlusion add-on:

  extract  SLIDES.pdf --work DIR   as above
  build    DIR plan.json           turn a plan (what to hide) into boxes
  preview  DIR                     draw the boxes on the slides to check them
  install  DIR | FILE.ankify.json  hand the boxes to the PDF Occlusion add-on

All coordinates are pixels at render scale 2.0 (144 dpi), top-left origin,
which is the space the add-on stores its boxes in.

Needs poppler (pdftotext, pdftoppm) or, failing that, pypdfium2 + Pillow.
Pillow is also what `preview` draws with. Standard library otherwise.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import statistics
import struct
import subprocess
import sys
import tempfile
import time
import unicodedata
import uuid
import xml.etree.ElementTree as ET

SCALE = 2.0
DPI = 72 * SCALE
ADDON_CODE = "783821131"
PORTABLE_EXT = ".ankify.json"
CARDS_EXT = ".ankify-cards.json"
NOTE_TYPE = "AnKingOverhaul (AnKing Step Deck / AnKingMed)"
ANKI_PYTHON = "~/Library/Application Support/AnkiProgramFiles/.venv/bin/python3"


def die(msg):
    sys.exit(f"ankify: {msg}")


# ------------------------------------------------------------------ extract

def _png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def _render_poppler(pdf, out_dir):
    prefix = os.path.join(out_dir, "raw")
    subprocess.run(["pdftoppm", "-r", str(int(DPI)), "-png", pdf, prefix], check=True)
    files = sorted(glob.glob(prefix + "-*.png"),
                   key=lambda p: int(re.search(r"-(\d+)\.png$", p).group(1)))
    out = []
    for i, src in enumerate(files):
        dst = os.path.join(out_dir, f"page-{i + 1:03d}.png")
        os.replace(src, dst)
        out.append(dst)
    return out


def _words_poppler(pdf):
    """Per page: (width_pt, height_pt, [[(text, x0, y0, x1, y1), ...] per line])."""
    xml = subprocess.run(["pdftotext", "-bbox-layout", pdf, "-"], check=True,
                         capture_output=True).stdout.decode("utf-8", "replace")
    xml = xml[xml.index("<doc>"):xml.rindex("</doc>") + len("</doc>")]
    xml = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", xml)
    pages = []
    for page in ET.fromstring(xml).iter("page"):
        lines = []
        for line in page.iter("line"):
            words = [((w.text or "").strip(), float(w.get("xMin")), float(w.get("yMin")),
                      float(w.get("xMax")), float(w.get("yMax")))
                     for w in line.iter("word")]
            words = [w for w in words if w[0]]
            if words:
                lines.append(words)
        pages.append((float(page.get("width")), float(page.get("height")), lines))
    return pages


def _extract_pdfium(pdf, out_dir):
    """Fallback when poppler is missing: pypdfium2 for text and rendering."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        die("need poppler (pdftotext, pdftoppm) or `pip install pypdfium2 pillow`")
    doc = pdfium.PdfDocument(pdf)
    pages, images = [], []
    for i in range(len(doc)):
        page = doc[i]
        w_pt, h_pt = page.get_size()
        tp = page.get_textpage()
        text = tp.get_text_range()
        words, cur = [], None
        for j in range(min(tp.count_chars(), len(text))):
            ch = text[j]
            if ch.isspace():
                if cur:
                    words.append(cur)
                    cur = None
                continue
            left, bottom, right, top = tp.get_charbox(j)
            if right <= left or top <= bottom:
                continue
            if cur is None:
                cur = [ch, left, h_pt - top, right, h_pt - bottom]
            else:
                cur = [cur[0] + ch, min(cur[1], left), min(cur[2], h_pt - top),
                       max(cur[3], right), max(cur[4], h_pt - bottom)]
        if cur:
            words.append(cur)
        lines = []
        for w in words:
            mid = (w[2] + w[4]) / 2
            if lines and lines[-1][-1][2] <= mid <= lines[-1][-1][4] and w[1] >= lines[-1][-1][1]:
                lines[-1].append(tuple(w))
            else:
                lines.append([tuple(w)])
        pages.append((w_pt, h_pt, lines))
        dst = os.path.join(out_dir, f"page-{i + 1:03d}.png")
        page.render(scale=SCALE).to_pil().save(dst)
        images.append(dst)
    return pages, images


_JXA = r"""
ObjC.import('Vision');
ObjC.import('Foundation');
function run(argv) {
    var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(
        $.NSURL.fileURLWithPath($(argv[0])), $());
    var req = $.VNRecognizeTextRequest.alloc.init;
    req.recognitionLevel = 0;
    req.usesLanguageCorrection = true;
    handler.performRequestsError($([req]), Ref());
    var out = [];
    var results = req.results;
    if (results) {
        for (var i = 0; i < results.count; i++) {
            var cands = results.objectAtIndex(i).topCandidates(1);
            if (!cands || cands.count === 0) { continue; }
            var top = cands.objectAtIndex(0);
            var s = ObjC.unwrap(top.string);
            var j = 0;
            while (j < s.length) {
                while (j < s.length && /\s/.test(s[j])) { j++; }
                var start = j;
                while (j < s.length && !/\s/.test(s[j])) { j++; }
                if (j <= start) { break; }
                var ro = top.boundingBoxForRangeError($.NSMakeRange(start, j - start), Ref());
                if (!ro) { continue; }
                var bb = ro.boundingBox;
                out.push({l: i, t: s.substring(start, j), c: top.confidence,
                          x: bb.origin.x, y: bb.origin.y, w: bb.size.width, h: bb.size.height});
            }
        }
    }
    return JSON.stringify(out);
}
"""


def _ocr_backend():
    if sys.platform == "darwin" and os.path.exists("/usr/bin/osascript"):
        return "vision"
    if shutil.which("tesseract"):
        return "tesseract"
    return None


def _ocr_vision(png, script):
    proc = subprocess.run(["/usr/bin/osascript", "-l", "JavaScript", script, png],
                          capture_output=True, text=True, timeout=90)
    if proc.returncode != 0:
        return []
    W, H = _png_size(png)
    lines = {}
    for o in json.loads(proc.stdout or "[]"):
        if float(o["c"]) < 0.3:
            continue
        x, y = o["x"] * W, (1.0 - o["y"] - o["h"]) * H
        lines.setdefault(o["l"], []).append((o["t"], x, y, x + o["w"] * W, y + o["h"] * H))
    return list(lines.values())


def _ocr_tesseract(png):
    proc = subprocess.run(["tesseract", png, "stdout", "tsv"], capture_output=True, text=True)
    lines = {}
    for row in proc.stdout.splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or not c[11].strip() or float(c[10]) < 40:
            continue
        x, y, w, h = (float(v) for v in c[6:10])
        lines.setdefault(tuple(c[1:5]), []).append((c[11].strip(), x, y, x + w, y + h))
    return list(lines.values())


def _pages_with_images(pdf):
    if not shutil.which("pdfimages"):
        return None
    out = subprocess.run(["pdfimages", "-list", pdf], capture_output=True, text=True).stdout
    pages = set()
    for row in out.splitlines()[2:]:
        c = row.split()
        if len(c) > 4 and c[0].isdigit() and int(c[3]) >= 150 and int(c[4]) >= 150:
            pages.add(int(c[0]))
    return pages


def cmd_extract(a):
    pdf = os.path.abspath(a.slides)
    if not os.path.exists(pdf):
        die(f"no such file: {pdf}")
    work = os.path.abspath(a.work or os.path.splitext(os.path.basename(pdf))[0] + ".ankify")
    img_dir = os.path.join(work, "pages")
    os.makedirs(img_dir, exist_ok=True)

    if shutil.which("pdftotext") and shutil.which("pdftoppm"):
        raw, images = _words_poppler(pdf), _render_poppler(pdf, img_dir)
    else:
        raw, images = _extract_pdfium(pdf, img_dir)
    if len(raw) != len(images):
        die(f"text has {len(raw)} pages but {len(images)} were rendered")

    backend = None if a.ocr == "off" else _ocr_backend()
    with_images = None if a.ocr == "all" else _pages_with_images(pdf)
    script = None
    if backend == "vision":
        fd, script = tempfile.mkstemp(suffix=".js", prefix="ankify_ocr_")
        with os.fdopen(fd, "w") as fh:
            fh.write(_JXA)

    pages, md = [], []
    for i, ((w_pt, h_pt, lines), png) in enumerate(zip(raw, images)):
        W, H = _png_size(png)
        sx, sy = W / w_pt, H / h_pt
        out_lines, wid = [], 0
        for ln in lines:
            words = []
            for t, x0, y0, x1, y1 in ln:
                words.append({"id": f"w{wid}", "t": t, "x": round(x0 * sx, 1), "y": round(y0 * sy, 1),
                              "w": round((x1 - x0) * sx, 1), "h": round((y1 - y0) * sy, 1)})
                wid += 1
            out_lines.append({"id": f"L{len(out_lines)}", "src": "text", "words": words})

        n_ocr = 0
        if backend and (with_images is None or (i + 1) in with_images):
            known = [w for ln in out_lines for w in ln["words"]]
            found = _ocr_vision(png, script) if backend == "vision" else _ocr_tesseract(png)
            for ln in sorted(found, key=lambda l: (round(l[0][2] / 10), l[0][1])):
                words = []
                for t, x0, y0, x1, y1 in ln:
                    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                    if any(k["x"] - 2 <= cx <= k["x"] + k["w"] + 2 and
                           k["y"] - 2 <= cy <= k["y"] + k["h"] + 2 for k in known):
                        continue    # the text layer already has this word
                    words.append({"id": f"w{wid}", "t": t, "x": round(x0, 1), "y": round(y0, 1),
                                  "w": round(x1 - x0, 1), "h": round(y1 - y0, 1)})
                    wid += 1
                if words:
                    out_lines.append({"id": f"L{len(out_lines)}", "src": "ocr", "words": words})
                    n_ocr += 1

        pages.append({"page": i + 1, "width": W, "height": H,
                      "image": os.path.relpath(png, work), "lines": out_lines})
        md.append(f"\n## p{i + 1} · {W}x{H} · {len(out_lines)} lines"
                  + (f" ({n_ocr} read from the image)" if n_ocr else ""))
        for ln in out_lines:
            first = ln["words"][0]
            tag = " (ocr)" if ln["src"] == "ocr" else ""
            md.append(f"{ln['id']} @{int(first['x'])},{int(first['y'])}{tag} | "
                      + " ".join(w["t"] for w in ln["words"]))
    if script:
        os.remove(script)

    notes = os.path.abspath(a.notes) if a.notes else ""
    if notes and shutil.which("pdftotext"):
        subprocess.run(["pdftotext", "-layout", notes, os.path.join(work, "notes.txt")])
        print("  notes.txt  the lecture notes as text")
    with open(os.path.join(work, "pages.json"), "w", encoding="utf-8") as f:
        json.dump({"slides": pdf, "notes": notes, "scale": SCALE, "page_count": len(pages),
                   "pages": pages}, f)
    with open(os.path.join(work, "text.md"), "w", encoding="utf-8") as f:
        f.write(f"# {os.path.basename(pdf)} · {len(pages)} pages\n" + "\n".join(md) + "\n")
    print(f"{len(pages)} pages -> {work}")
    print("  text.md    every line of every slide, with line ids")
    print(f"  pages/     page-NNN.png, the slides at {int(DPI)} dpi")
    print(f"  ocr: {backend or 'none'}"
          + ("" if backend else " (labels inside figures need {\"rect\": [x, y, w, h]} targets)"))


# -------------------------------------------------------------------- build

def _norm(tok):
    tok = unicodedata.normalize("NFKC", tok).lower()
    return re.sub(r"^\W+|\W+$", "", tok)


def _union(rects):
    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    x1 = max(r[0] + r[2] for r in rects)
    y1 = max(r[1] + r[3] for r in rects)
    return [x0, y0, x1 - x0, y1 - y0]


def _pad(rect, W, H):
    pad = max(3.0, 0.15 * rect[3]) if rect[3] < 120 else 6.0
    x0, y0 = max(0, rect[0] - pad), max(0, rect[1] - pad)
    x1, y1 = min(W, rect[0] + rect[2] + pad), min(H, rect[1] + rect[3] + pad)
    return [int(round(x0)), int(round(y0)), int(round(x1 - x0)), int(round(y1 - y0))]


def _line_range(spec, line_ids):
    ids = []
    for part in spec.split(","):
        m = re.fullmatch(r"L(\d+)(?:\s*-\s*L?(\d+))?", part.strip())
        if not m:
            raise ValueError(f"bad line range {spec!r}")
        ids += [f"L{k}" for k in range(int(m.group(1)), int(m.group(2) or m.group(1)) + 1)]
    missing = [k for k in ids if k not in line_ids]
    if missing:
        raise ValueError(f"no such line {missing[0]}")
    return ids


class _Page:
    def __init__(self, page):
        self.W, self.H = page["width"], page["height"]
        self.lines = {ln["id"]: ln for ln in page["lines"]}
        self.seq = [(w, ln["id"]) for ln in page["lines"] for w in ln["words"] if _norm(w["t"])]
        self.used = set()

    def phrase(self, text, line=None, occurrence=None, warn=None):
        toks = [t for t in (_norm(t) for t in text.split()) if t]
        if not toks:
            raise ValueError(f"nothing to match in {text!r}")
        hits = []
        for s in range(len(self.seq) - len(toks) + 1):
            if all(_norm(self.seq[s + k][0]["t"]) == toks[k] for k in range(len(toks))):
                if line is None or self.seq[s][1] == line:
                    hits.append(s)
        if not hits:
            raise ValueError(f"text not found: {text!r}")
        if occurrence:
            if occurrence > len(hits):
                raise ValueError(f"{text!r} occurs {len(hits)}x, not {occurrence}")
            start = hits[occurrence - 1]
        else:
            free = [h for h in hits if h not in self.used] or hits
            start = free[0]
            if len(hits) > 1 and warn is not None:
                where = ", ".join(self.seq[h][1] for h in hits)
                warn.append(f"{text!r} occurs {len(hits)}x ({where}); used the first free one, "
                            f"on {self.seq[start][1]}. Add \"line\" and/or \"occurrence\" "
                            "(counted among the matches on that line) to choose.")
        self.used.update(range(start, start + len(toks)))
        by_line = {}
        for w, lid in self.seq[start:start + len(toks)]:
            by_line.setdefault(lid, []).append([w["x"], w["y"], w["w"], w["h"]])
        return [_union(r) for r in by_line.values()]

    def whole_lines(self, spec, each=False):
        rects = [_union([[w["x"], w["y"], w["w"], w["h"]] for w in self.lines[lid]["words"]])
                 for lid in _line_range(spec, self.lines)]
        return rects if each else [_union(rects)]

    def resolve(self, target, warn):
        """One target -> (rects, already_padded)."""
        if isinstance(target, str):
            if re.fullmatch(r"L\d+(\s*[-,]\s*L?\d+)*", target.strip()):
                return self.whole_lines(target), False
            return self.phrase(target, warn=warn), False
        if "rect" in target:
            x, y, w, h = (float(v) for v in target["rect"])
            return [[int(x), int(y), int(w), int(h)]], True
        if "lines" in target:
            return self.whole_lines(target["lines"], bool(target.get("each"))), False
        if "text" in target:
            rects = self.phrase(target["text"], target.get("line"), target.get("occurrence"), warn)
            return ([_union(rects)] if target.get("block") else rects), False
        raise ValueError(f"cannot read target {target!r}")


def _overlap(a, b):
    w = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])
    h = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / max(1.0, min(a["w"] * a["h"], b["w"] * b["h"]))


def cmd_build(a):
    work = os.path.abspath(a.work)
    with open(os.path.join(work, "pages.json"), encoding="utf-8") as f:
        doc = json.load(f)
    with open(a.plan, encoding="utf-8") as f:
        plan = json.load(f)
    by_num = {p["page"]: p for p in doc["pages"]}
    errors, warnings, boxes, per_page = [], [], {}, []

    for key, cards in (plan.get("pages") or {}).items():
        num = int(str(key).lstrip("p"))
        if num not in by_num:
            errors.append(f"p{num}: the PDF has {doc['page_count']} pages")
            continue
        page, out, gid = _Page(by_num[num]), [], 0
        for ci, card in enumerate(cards, 1):
            if isinstance(card, (str, list)) or "hide" not in card:
                card = {"hide": card}       # a bare target is a card of its own
            targets = card.get("hide")
            if isinstance(targets, (str, dict)):
                targets = [targets]
            rects, warn = [], []
            try:
                for t in targets or []:
                    got, padded = page.resolve(t, warn)
                    rects += [r if padded else _pad(r, page.W, page.H) for r in got]
            except (ValueError, KeyError, TypeError) as e:
                errors.append(f"p{num} card {ci}: {e}")
                continue
            warnings += [f"p{num} card {ci}: {w}" for w in warn]
            if not rects:
                errors.append(f"p{num} card {ci}: nothing to hide")
                continue
            mode = card.get("mode") if card.get("mode") in ("ao", "oa") else None
            grouped = len(rects) > 1
            guid = uuid.uuid4().hex if grouped else None
            for r in rects:
                out.append({"x": r[0], "y": r[1], "w": r[2], "h": r[3],
                            "group": gid if grouped else None, "group_uid": guid,
                            "shape": "rect", "mode": mode, "note": "", "id": uuid.uuid4().hex,
                            "_card": ci})
            gid += grouped
        for i, b in enumerate(out):
            for c in out[i + 1:]:
                if b["_card"] != c["_card"] and _overlap(b, c) > 0.5:
                    warnings.append(f"p{num}: cards {b['_card']} and {c['_card']} overlap; "
                                    "one hides the other's answer")
        if out:
            per_page.append(len({b["_card"] for b in out}))
            boxes[str(num - 1)] = [{k: v for k, v in b.items() if k != "_card"} for b in out]

    for w in dict.fromkeys(warnings):
        print("warning:", w)
    if errors:
        print("\n".join("error: " + e for e in errors))
        die(f"{len(errors)} problem(s) in the plan; nothing written")

    slides = doc["slides"]
    stem = os.path.splitext(os.path.basename(slides))[0]
    session = {
        "lecture": plan.get("lecture") or stem,
        "notes_pdf": plan.get("notes_pdf", doc.get("notes", "")),
        "boxes": boxes, "page_modes": {}, "annotations": {},
        "note_map": {}, "image_map": {}, "cloze_cards": {}, "cloze_stale": [],
        "render_scale": SCALE, "page_count": doc["page_count"],
        "deck": plan.get("deck", ""), "pdf_path": slides,
    }
    with open(os.path.join(work, "session.json"), "w", encoding="utf-8") as f:
        json.dump(session, f)
    portable = {"ankify": 1, "slides_name": os.path.basename(slides),
                "notes_name": os.path.basename(session["notes_pdf"]), "session": session}
    targets = [os.path.join(work, stem + PORTABLE_EXT)]
    if a.out:
        os.makedirs(os.path.abspath(a.out), exist_ok=True)
        targets.append(os.path.join(os.path.abspath(a.out), stem + PORTABLE_EXT))
    for t in targets:
        with open(t, "w", encoding="utf-8") as f:
            json.dump(portable, f)

    done = sorted(int(k) + 1 for k in boxes)
    skipped = [n for n in range(1, doc["page_count"] + 1) if n not in done]
    print(f"{sum(per_page)} cards, {sum(len(v) for v in boxes.values())} boxes on "
          f"{len(done)}/{doc['page_count']} slides"
          + (f" (median {statistics.median(per_page):g}, max {max(per_page)} per slide)"
             if per_page else ""))
    print("deck:", session["deck"] or "(none set)")
    print("slides without cards:", ", ".join(map(str, skipped)) or "none")
    print("wrote:", ", ".join(targets))


# ------------------------------------------------------------------ preview

_GROUP_COLORS = [(0, 120, 255), (0, 160, 60), (200, 0, 200), (255, 120, 0),
                 (0, 170, 170), (120, 80, 0)]


def _page_list(spec, available):
    if not spec:
        return available
    want = set()
    for part in spec.split(","):
        lo, _, hi = part.partition("-")
        want.update(range(int(lo), int(hi or lo) + 1))
    return [n for n in available if n in want]


def cmd_preview(a):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        die("preview needs Pillow: pip install pillow")
    work = os.path.abspath(a.work)
    with open(os.path.join(work, "pages.json"), encoding="utf-8") as f:
        doc = json.load(f)
    session = {"boxes": {}}     # before build: plain contact sheets of the slides
    if os.path.exists(os.path.join(work, "session.json")):
        with open(os.path.join(work, "session.json"), encoding="utf-8") as f:
            session = json.load(f)
    out_dir = os.path.join(work, "preview")
    os.makedirs(out_dir, exist_ok=True)
    name = "zoom" if a.pages else "sheet"    # a zoom never replaces the full set
    for old in glob.glob(os.path.join(out_dir, name + "-*.jpg")):
        os.remove(old)

    everything = [p["page"] for p in doc["pages"]]
    occluded = [n for n in everything if session["boxes"].get(str(n - 1))]
    nums = (_page_list(a.pages, everything) if a.pages
            else everything if a.all or not occluded else occluded)
    by_num = {p["page"]: p for p in doc["pages"]}
    tiles = []
    for n in nums:
        img = Image.open(os.path.join(work, by_num[n]["image"])).convert("RGB")
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        boxes = session["boxes"].get(str(n - 1), [])
        for b in boxes:
            c = (230, 0, 0) if b["group"] is None else _GROUP_COLORS[b["group"] % len(_GROUP_COLORS)]
            draw.rectangle([b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]],
                           fill=c + (60,), outline=c + (255,), width=4)
        cards = len({b["group_uid"] or b["id"] for b in boxes})
        draw.rectangle([0, 0, 300, 44], fill=(255, 255, 0, 255))
        img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
        label = f"p{n}  {cards} card(s)" if boxes else f"p{n}"
        ImageDraw.Draw(img).text((8, 8), label, fill=(0, 0, 0), font_size=30)
        tiles.append(img.resize((a.width, round(img.height * a.width / img.width))))
    per = a.per_sheet
    cols = 1 if per == 1 else 2
    written = []
    for s in range(0, len(tiles), per):
        chunk = tiles[s:s + per]
        h = max(t.height for t in chunk)
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (a.width * cols, h * rows), (255, 255, 255))
        for i, t in enumerate(chunk):
            sheet.paste(t, ((i % cols) * a.width, (i // cols) * h))
        path = os.path.join(out_dir, f"{name}-{s // per + 1:02d}.jpg")
        sheet.save(path, quality=80)
        written.append(path)
    print(f"{len(tiles)} slides on {len(written)} sheet(s): {out_dir}/{name}-NN.jpg"
          + ("" if session["boxes"] else " (no boxes built yet)"))
    print("red = a card of its own; same colour = boxes hidden together as one card")


# ------------------------------------------------------------------ install

def _addon_dir(explicit):
    if explicit:
        return os.path.abspath(os.path.expanduser(explicit))
    bases = [os.path.expanduser("~/Library/Application Support/Anki2/addons21"),
             os.path.expanduser("~/.local/share/Anki2/addons21"),
             os.path.join(os.environ.get("APPDATA", ""), "Anki2", "addons21")]
    for base in bases:
        for name in [ADDON_CODE] + (sorted(os.listdir(base)) if os.path.isdir(base) else []):
            d = os.path.join(base, name)
            if os.path.exists(os.path.join(d, "session_store.py")) and \
                    os.path.exists(os.path.join(d, "pdf_occlusion_dialog.py")):
                return d
    die("could not find the PDF Occlusion add-on; pass --addon-dir")


def _find_file(name, hint=""):
    if hint and os.path.exists(hint):
        return os.path.abspath(hint)
    if not name:
        return ""
    home = os.path.expanduser("~")
    roots = [os.path.join(home, d) for d in ("Downloads", "Desktop", "Documents")]
    roots += glob.glob(os.path.join(home, "OneDrive*"))
    hits = []
    for root in roots:
        depth0 = root.count(os.sep)
        for cur, dirs, files in os.walk(root):
            if cur.count(os.sep) - depth0 >= 4:
                dirs[:] = []
            dirs[:] = [d for d in dirs if not d.startswith(".") and not d.endswith(".ankify")]
            if name in files:
                hits.append(os.path.join(cur, name))
    if len(hits) > 1:
        hits.sort(key=os.path.getmtime, reverse=True)
        print(f"note: {name} found in {len(hits)} places; using {hits[0]}")
    return hits[0] if hits else ""


def cmd_install(a):
    src = os.path.abspath(a.source)
    if os.path.isdir(src):
        found = (glob.glob(os.path.join(src, "*" + PORTABLE_EXT))
                 + glob.glob(os.path.join(src, "*" + CARDS_EXT)))
        if not found:
            die(f"nothing to install in {src}; run cards (or build) first")
        if len(found) > 1:
            die("this folder has both text cards and occlusion boxes; pass the file to install: "
                + ", ".join(os.path.basename(p) for p in found))
        src = found[0]
    if src.endswith(CARDS_EXT):
        return _install_cards(a, src)
    with open(src, encoding="utf-8") as f:
        portable = json.load(f)
    session = portable["session"]

    slides = _find_file(portable.get("slides_name", ""), a.pdf or session.get("pdf_path", ""))
    if not slides:
        die(f"cannot find {portable.get('slides_name')} on this computer; pass --pdf PATH")
    notes = _find_file(portable.get("notes_name", ""), a.notes or session.get("notes_pdf", ""))
    if portable.get("notes_name") and not notes:
        print(f"note: notes PDF {portable['notes_name']} not found; attach it in the add-on")

    addon = _addon_dir(a.addon_dir)
    sessions = os.path.join(addon, "user_files", "sessions")
    os.makedirs(sessions, exist_ok=True)
    key = hashlib.sha1(slides.encode("utf-8")).hexdigest()[:20]
    dest = os.path.join(sessions, key + ".json")
    if os.path.exists(dest):
        with open(dest, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("note_map") and not a.force:
            die(f"{os.path.basename(slides)} already has {len(old['note_map'])} cards made from "
                "it. Installing would orphan them. Re-run with --force only if the user agrees.")
        backup_dir = os.path.join(addon, "user_files", "ankify_backups")
        os.makedirs(backup_dir, exist_ok=True)
        backup = os.path.join(backup_dir, f"{key}-{int(time.time())}.json")
        shutil.copy2(dest, backup)
        print("existing session backed up to", backup)

    payload = dict(session, pdf_path=slides, notes_pdf=notes,
                   saved_at=int(time.time()), version=1)
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    os.replace(tmp, dest)
    cards = sum(len({b["group_uid"] or b["id"] for b in v}) for v in payload["boxes"].values())
    print(f"installed {cards} cards' worth of boxes for {os.path.basename(slides)}")
    print("deck:", payload.get("deck") or "(pick one in the add-on)")
    print("next: in Anki open this PDF in PDF Occlusion, answer YES to \"Resume your saved "
          "session\" (No deletes it), check the boxes, then Create All Cards.")


# -------------------------------------------------------------------- cards

_CLOZE_RE = re.compile(r"\{\{c(\d+)::(.*?)\}\}", re.S)
_LONG_ANSWER = 12   # words; past this a cloze is usually a list or a whole clause


def cmd_cards(a):
    work = os.path.abspath(a.work)
    with open(os.path.join(work, "pages.json"), encoding="utf-8") as f:
        doc = json.load(f)
    with open(a.cards, encoding="utf-8") as f:
        plan = json.load(f)
    deck = (plan.get("deck") or "").strip()
    errors, warnings, cards, per_slide, n_cards = [], [], [], {}, 0
    if not deck:
        errors.append('no "deck"')

    for i, card in enumerate(plan.get("cards") or [], 1):
        text = (card.get("text") or "").strip()
        slide = card.get("slide")
        found = _CLOZE_RE.findall(text)
        nums = sorted({int(n) for n, _ in found})
        if not nums:
            errors.append(f"card {i}: nothing hidden, needs {{{{c1::...}}}}: {text[:60]}")
        elif nums != list(range(1, len(nums) + 1)):
            errors.append(f"card {i}: cloze numbers {nums} should run 1..{len(nums)}")
        if slide is not None and not (isinstance(slide, int) and 1 <= slide <= doc["page_count"]):
            errors.append(f"card {i}: slide {slide!r} (the PDF has {doc['page_count']} pages; "
                          "use null for a fact that is only in the notes)")
        for _, answer in found:
            answer = answer.split("::")[0]
            if len(answer.split()) > _LONG_ANSWER:
                warnings.append(f"card {i}: a {len(answer.split())}-word answer: {answer[:50]}...")
        if len(nums) > 3:
            warnings.append(f"card {i}: {len(nums)} cards from one sentence; split it")
        cards.append({"slide": slide, "text": text})
        per_slide[slide] = per_slide.get(slide, 0) + 1
        n_cards += len(nums)

    if not cards:
        errors.append("no cards")
    for w in warnings:
        print("warning:", w)
    if errors:
        print("\n".join("error: " + e for e in errors))
        die(f"{len(errors)} problem(s) in the cards; nothing written")

    slides = doc["slides"]
    stem = os.path.splitext(os.path.basename(slides))[0]
    portable = {"ankify": 1, "kind": "cards", "deck": deck,
                "slides_name": os.path.basename(slides), "slides_path": slides,
                "notes_name": os.path.basename(doc.get("notes", "")),
                "notes_path": doc.get("notes", ""), "cards": cards}
    targets = [os.path.join(work, stem + CARDS_EXT)]
    if a.out:
        os.makedirs(os.path.abspath(a.out), exist_ok=True)
        targets.append(os.path.join(os.path.abspath(a.out), stem + CARDS_EXT))
    for t in targets:
        with open(t, "w", encoding="utf-8") as f:
            json.dump(portable, f)

    used = sorted(s for s in per_slide if s is not None)
    skipped = [n for n in range(1, doc["page_count"] + 1) if n not in used]
    print(f"{len(cards)} notes, {n_cards} cards on {len(used)}/{doc['page_count']} slides"
          + (f" (max {max(per_slide[s] for s in used)} notes per slide)" if used else "")
          + (f", {per_slide[None]} from the notes only" if None in per_slide else ""))
    print("deck:", deck)
    print("slides without cards:", ", ".join(map(str, skipped)) or "none")
    print("wrote:", ", ".join(targets))


def _anki_running():
    return subprocess.run(["pgrep", "-f", r"aqt\.run\(\)|Anki\.app/Contents/MacOS/"],
                          capture_output=True).returncode == 0


def _collection_path(explicit):
    if explicit:
        path = os.path.abspath(os.path.expanduser(explicit))
        if not os.path.exists(path):
            die(f"no such collection: {path}")
        return path
    bases = [os.path.expanduser("~/Library/Application Support/Anki2"),
             os.path.expanduser("~/.local/share/Anki2"),
             os.path.join(os.environ.get("APPDATA", ""), "Anki2")]
    found = [p for b in bases for p in glob.glob(os.path.join(b, "*", "collection.anki2"))]
    if len(found) != 1:
        die(("no Anki collection found" if not found else
             "several Anki profiles: " + ", ".join(found)) + "; pass --collection PATH")
    return found[0]


def _publish_pdfs(addon, slides, notes):
    """Public URLs for the two PDFs through the add-on's own hosting, else file:// links."""
    import importlib.util
    import pathlib

    def local(p):
        return pathlib.Path(p).as_uri() if p else ""

    config = {}
    for name in ("config.json", "meta.json"):       # meta.json holds the user's overrides
        path = os.path.join(addon, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            config.update((data.get("config") or {}) if name == "meta.json" else data)
    spec = importlib.util.spec_from_file_location(
        "ankify_pdf_hosting", os.path.join(addon, "pdf_hosting.py"))
    hosting_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hosting_mod)
    hosting = hosting_mod.settings(config.get("pdf_hosting"))
    if not hosting:
        print("note: PDF hosting is off in the add-on; the buttons will only open on this computer")
        return local(slides), local(notes)
    urls = [hosting_mod.publish(p, hosting) if p else "" for p in (slides, notes)]
    if hosting["git_push"]:
        try:
            hosting_mod.push(hosting, [u for u in urls if u])
        except hosting_mod.PublishError as e:
            print(f"note: the PDFs were not pushed ({e}); the buttons work once that folder is pushed")
    return urls


def _slide_image(pdf, num, pages_dir, out_dir, name):
    dst = os.path.join(out_dir, name)
    src = os.path.join(pages_dir, f"page-{num:03d}.png")
    if os.path.exists(src):
        shutil.copyfile(src, dst)
    elif shutil.which("pdftoppm"):
        subprocess.run(["pdftoppm", "-r", str(int(DPI)), "-png", "-singlefile", "-f", str(num),
                        "-l", str(num), pdf, dst[:-4]], check=True)
    else:
        die("poppler (pdftoppm) is needed to render the slides; brew install poppler")
    return dst


# Same look as .io-doc-btn on PDF Occlusion cards, inlined because the AnKing note type has no
# such class and its template is not ours to edit.
_BTN = ("display:inline-block;margin:3px;padding:6px 16px;font:normal 13px Arial,sans-serif;"
        "color:inherit;text-decoration:none;background:transparent;"
        "border:1px solid rgba(131,110,170,0.55);border-radius:4px;")


def _install_cards(a, src):
    try:
        from anki.collection import Collection
    except ImportError:
        py = os.path.expanduser(ANKI_PYTHON)
        if os.environ.get("ANKIFY_REEXEC") or not os.path.exists(py):
            die("writing cards needs Anki's own Python, expected at " + py)
        os.environ["ANKIFY_REEXEC"] = "1"
        os.execv(py, [py, os.path.abspath(__file__)] + sys.argv[1:])

    with open(src, encoding="utf-8") as f:
        portable = json.load(f)
    slides = _find_file(portable.get("slides_name", ""), a.pdf or portable.get("slides_path", ""))
    if not slides:
        die(f"cannot find {portable.get('slides_name')} on this computer; pass --pdf PATH")
    notes = _find_file(portable.get("notes_name", ""), a.notes or portable.get("notes_path", ""))
    if portable.get("notes_name") and not notes:
        print(f"note: notes PDF {portable['notes_name']} not found; cards get a Slides button only")

    col_path = _collection_path(a.collection)
    # Anki holds its collection open; a second writer can lose or corrupt changes.
    if not a.collection:
        waited = 0
        while _anki_running():
            if not a.wait:
                die("Anki is open. Quit Anki and run this again, or pass --wait to wait for it.")
            if waited == 0:
                print("waiting for Anki to be quit...", flush=True)
            if waited >= 30 * 60:
                die("Anki is still open after 30 minutes; nothing was changed")
            time.sleep(5)
            waited += 5
        if waited:
            time.sleep(3)     # let Anki finish closing the file

    slides_url, notes_url = _publish_pdfs(_addon_dir(a.addon_dir), slides, notes)
    bar = '<div style="margin-top:10px;text-align:center;">' + "".join(
        f'<a href="{url}" style="{_BTN}">{label}</a>'
        for label, url in (("Notes", notes_url), ("Slides", slides_url)) if url) + "</div>"

    sha = hashlib.sha1()
    with open(slides, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            sha.update(chunk)
    prefix = f"ankify_{sha.hexdigest()[:10]}_p"
    pages_dir = os.path.join(os.path.dirname(src), "pages")

    if not a.collection:
        backup = os.path.join(os.path.dirname(col_path), "collection.before-ankify.anki2")
        shutil.copy2(col_path, backup)
        print("collection backed up to", backup)

    col = Collection(col_path)
    try:
        model = col.models.by_name(NOTE_TYPE)
        if not model:
            die(f"this collection has no note type named {NOTE_TYPE}")
        deck = portable["deck"]
        existing = col.decks.id(deck, create=False)
        if existing and not a.force:
            n = col.db.scalar("select count() from cards where did = ?", existing)
            if n:
                die(f"the deck {deck} already has {n} cards. Re-run with --force to add to it "
                    "only if the user agrees.")
        did = col.decks.id(deck)
        images = {}
        with tempfile.TemporaryDirectory() as tmp:
            for num in sorted({c["slide"] for c in portable["cards"] if c["slide"]}):
                png = _slide_image(slides, num, pages_dir, tmp, f"{prefix}{num:03d}.png")
                images[num] = col.media.add_file(png)
        for card in portable["cards"]:
            note = col.new_note(model)
            note["Text"] = card["text"]
            img = f'<img src="{images[card["slide"]]}">' if card["slide"] else ""
            note["Extra"] = img + bar
            col.add_note(note, did)
        n_cards = col.db.scalar("select count() from cards where did = ?", did)
    finally:
        col.close()
    print(f"added {len(portable['cards'])} notes ({n_cards} cards in the deck) to {deck}")
    print("next: open Anki; the cards are new cards in that deck. To undo, delete the deck.")


# --------------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("extract", help="render the slides and list their text")
    s.add_argument("slides")
    s.add_argument("--notes", help="the lecture-notes PDF to attach to the cards")
    s.add_argument("--work", help="working folder (default: <slides>.ankify)")
    s.add_argument("--ocr", choices=["auto", "all", "off"], default="auto",
                   help="read text inside figures; auto = only slides that contain an image")
    s.set_defaults(fn=cmd_extract)

    s = sub.add_parser("build", help="turn plan.json into boxes")
    s.add_argument("work")
    s.add_argument("plan")
    s.add_argument("--out", help="also copy the .ankify.json here (e.g. ~/Downloads/jeff/ankify)")
    s.set_defaults(fn=cmd_build)

    s = sub.add_parser("cards", help="check cards.json and package the text cards")
    s.add_argument("work")
    s.add_argument("cards")
    s.add_argument("--out", help="also copy the .ankify-cards.json here (e.g. ~/Downloads/jeff/ankify)")
    s.set_defaults(fn=cmd_cards)

    s = sub.add_parser("preview", help="draw the boxes on the slides")
    s.add_argument("work")
    s.add_argument("--pages", help="e.g. 3,7-12 (default: every slide with boxes)")
    s.add_argument("--all", action="store_true", help="include slides without boxes")
    s.add_argument("--per-sheet", type=int, default=4, choices=[1, 2, 4, 6])
    s.add_argument("--width", type=int, default=1000, help="pixels per slide")
    s.set_defaults(fn=cmd_preview)

    s = sub.add_parser("install", help="add text cards to Anki, or give boxes to the add-on")
    s.add_argument("source", help="the working folder, a .ankify-cards.json or a .ankify.json")
    s.add_argument("--pdf", help="where the slides PDF is on this computer")
    s.add_argument("--notes", help="where the notes PDF is on this computer")
    s.add_argument("--addon-dir")
    s.add_argument("--force", action="store_true")
    s.add_argument("--wait", action="store_true",
                   help="text cards: wait up to 30 minutes for Anki to be quit")
    s.add_argument("--collection", help="text cards: a collection.anki2 other than the profile's")
    s.set_defaults(fn=cmd_install)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
