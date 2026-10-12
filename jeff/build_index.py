#!/usr/bin/env python3
"""Write each block's index.json: its lecture files, their names and question counts.

The site reads this instead of asking the GitHub API to list a block, so it
never trips the API's per-IP rate limit. Run it after adding or changing a
lecture; .github/workflows/jeff-index.yml does so on every push.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).parent
MANIFESTS = {"index.json", "weeks.json", "gate.json"}

for block in sorted(p for p in ROOT.iterdir() if p.is_dir()):
    files = sorted(f for f in block.glob("*.json") if f.name not in MANIFESTS)
    if not files:
        continue
    lectures = []
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        lectures.append({
            "file": f.name,
            "name": data.get("lecture") or f.name,
            "count": len(data.get("questions") or []),
        })
    out = {"block": block.name, "lectures": lectures}
    (block / "index.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{block.name}: {len(lectures)} lectures")
