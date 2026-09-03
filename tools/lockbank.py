#!/usr/bin/env python3
"""Lock and unlock the jeff question bank.

The bank lives in a public repo, so a login screen would be theatre — anyone
can read the files straight off github.io. Instead the questions are stored
encrypted, and the puzzle answer *is* the key: it is stretched with PBKDF2 and
the result decrypts the files. Nothing on the server can be used to recover it.

    JEFF_KEY='...' python3 tools/lockbank.py init     # new salt + canary
    JEFF_KEY='...' python3 tools/lockbank.py lock     # encrypt plaintext files
    JEFF_KEY='...' python3 tools/lockbank.py unlock   # decrypt, to edit them
    python3 tools/lockbank.py status                  # what is locked

Both lock and unlock are idempotent: a file already in the target state is
left alone, so re-running after adding a lecture only touches the new one.
"""

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import secrets
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "jeff"
GATE = BANK / "gate.json"

# Files under a block folder that aren't lecture content.
SKIP = {"gate.json"}

ITERATIONS = 2_000_000
CANARY = b"jeff-unlocked"


def b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def b64d(text: str) -> bytes:
    return base64.b64decode(text)


def normalize(passphrase: str) -> str:
    """Fold case and punctuation so "Rectal-Prolapse!" == "rectal prolapse".

    The browser does the same thing; the two must agree exactly or the key
    comes out different and nothing decrypts.
    """
    return " ".join(re.sub(r"[^a-z0-9]+", " ", passphrase.lower()).split())


def derive(passphrase: str, salt: bytes, iterations: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", normalize(passphrase).encode(), salt, iterations, 32)


def encrypt(key: bytes, plaintext: bytes) -> dict:
    iv = secrets.token_bytes(12)
    return {"v": 1, "iv": b64e(iv), "ct": b64e(AESGCM(key).encrypt(iv, plaintext, None))}


def decrypt(key: bytes, blob: dict) -> bytes:
    return AESGCM(key).decrypt(b64d(blob["iv"]), b64d(blob["ct"]), None)


def is_locked(blob) -> bool:
    return isinstance(blob, dict) and blob.get("v") == 1 and "iv" in blob and "ct" in blob


def content_files():
    """Every lecture JSON and week manifest, block by block."""
    for block in sorted(p for p in BANK.iterdir() if p.is_dir()):
        for f in sorted(block.glob("*.json")):
            if f.name not in SKIP:
                yield f


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def passphrase_from_env(prompt: str) -> str:
    value = os.environ.get("JEFF_KEY") or getpass.getpass(prompt)
    if not normalize(value):
        sys.exit("empty passphrase")
    return value


def load_gate():
    if not GATE.exists():
        sys.exit(f"no {GATE.relative_to(ROOT)} — run `init` first")
    return read_json(GATE)


def cmd_init(args):
    salt = secrets.token_bytes(16)
    passphrase = passphrase_from_env("new puzzle answer: ")
    key = derive(passphrase, salt, ITERATIONS)

    prompt = args.prompt
    if GATE.exists() and not prompt:
        prompt = read_json(GATE).get("prompt", "")

    GATE.write_text(json.dumps({
        "v": 1,
        "salt": b64e(salt),
        "iters": ITERATIONS,
        "check": encrypt(key, CANARY),
        "prompt": prompt or "",
    }, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {GATE.relative_to(ROOT)} (salt + canary; the answer itself is not stored)")


def key_from_gate(gate) -> bytes:
    passphrase = passphrase_from_env("puzzle answer: ")
    key = derive(passphrase, b64d(gate["salt"]), gate.get("iters", ITERATIONS))
    try:
        if decrypt(key, gate["check"]) != CANARY:
            raise ValueError
    except Exception:
        sys.exit("wrong answer — that passphrase does not match gate.json")
    return key


def cmd_lock(args):
    key = key_from_gate(load_gate())
    done = skipped = 0
    for path in content_files():
        blob = read_json(path)
        if is_locked(blob):
            skipped += 1
            continue
        payload = json.dumps(blob, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        path.write_text(json.dumps(encrypt(key, payload), indent=2) + "\n", encoding="utf-8")
        done += 1
        print(f"  locked {path.relative_to(ROOT)}")
    print(f"locked {done} file(s), {skipped} already locked")


def cmd_unlock(args):
    key = key_from_gate(load_gate())
    done = skipped = 0
    for path in content_files():
        blob = read_json(path)
        if not is_locked(blob):
            skipped += 1
            continue
        plain = json.loads(decrypt(key, blob))
        path.write_text(json.dumps(plain, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        done += 1
        print(f"  unlocked {path.relative_to(ROOT)}")
    print(f"unlocked {done} file(s), {skipped} already plaintext")


def cmd_status(args):
    locked = [p for p in content_files() if is_locked(read_json(p))]
    plain = [p for p in content_files() if not is_locked(read_json(p))]
    print(f"locked:    {len(locked)}")
    for p in plain:
        print(f"  PLAINTEXT {p.relative_to(ROOT)}")
    print(f"plaintext: {len(plain)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init", help="write a fresh gate.json")
    p_init.add_argument("--prompt", default="", help="the riddle shown on the gate")
    p_init.set_defaults(func=cmd_init)

    sub.add_parser("lock", help="encrypt plaintext content").set_defaults(func=cmd_lock)
    sub.add_parser("unlock", help="decrypt content for editing").set_defaults(func=cmd_unlock)
    sub.add_parser("status", help="show what is locked").set_defaults(func=cmd_status)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
