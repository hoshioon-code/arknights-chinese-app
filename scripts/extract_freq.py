#!/usr/bin/env python3
"""Parse Arknights story scripts (CN/JP), pair dialogue lines, extract word frequencies."""
import json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-src"

NAME_RE = re.compile(r'^\[name="([^"]*)"\]\s*(.*)$')
TAG_RE = re.compile(r'<[^>]+>')

def parse_script(path: Path):
    lines = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = NAME_RE.match(raw.strip())
        if not m:
            continue
        speaker, text = m.group(1), m.group(2).strip()
        text = TAG_RE.sub("", text).replace("{nickname}", "博士").strip()
        if not text:
            continue
        lines.append({"speaker": speaker, "text": text})
    return lines

def main():
    eps = (SRC / "episode_list.txt").read_text().split()
    seen = set()
    all_pairs = []
    mismatch = []
    for ep in eps:
        fn = ep.replace("/", "_") + ".txt"
        if fn in seen:
            continue
        seen.add(fn)
        zh = parse_script(SRC / "story_zh" / fn)
        jp = parse_script(SRC / "story_jp" / fn)
        if len(zh) != len(jp):
            mismatch.append((ep, len(zh), len(jp)))
        for a, b in zip(zh, jp):
            all_pairs.append((a["text"], b["text"]))
    print(f"episodes={len(seen)} paired_lines={len(all_pairs)} mismatches={mismatch}", file=sys.stderr)

    # segmentation frequency (plain jieba first pass)
    import jieba
    jieba.setLogLevel(60)
    freq = Counter()
    for zh, _ in all_pairs:
        for w in jieba.cut(zh):
            w = w.strip()
            if len(w) >= 2 and re.search(r'[一-鿿]', w):
                freq[w] += 1
    out = [f"{c}\t{w}" for w, c in freq.most_common(500)]
    Path("/tmp/freq.txt").write_text("\n".join(out), encoding="utf-8")
    print("wrote /tmp/freq.txt", file=sys.stderr)

if __name__ == "__main__":
    main()
