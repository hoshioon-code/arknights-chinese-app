#!/usr/bin/env python3
"""Reorganize generated MP3s into per-chapter bucket folders and build the
audio manifest (data/audio_chapters.json) with per-chapter sizes.

Layout:
  audio/main_0/*.mp3   lines whose first home chapter is 序章 (main_0)
  audio/main_1/*.mp3   lines whose first home chapter is 第1章 (main_1)
  audio/common/*.mp3   term / vocab word clips not owned by a chapter

Each chapter's manifest entry lists every URL its lessons need (a clip
shared with another chapter keeps one physical copy; the URL may point
into another bucket) plus the total download size for that chapter, so
the app can offer per-chapter download/delete via Cache Storage, and the
site owner can rotate chapters to stay under the GitHub Pages 1GB cap.
Also rewrites data/audio_map.json to the bucketed paths.
"""
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
AUDIO = ROOT / "audio"

def fname(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16] + ".mp3"

def main():
    todo = set(json.loads((DATA / "audio_todo.json").read_text(encoding="utf-8")))
    # chapter line texts
    ch_lines = {}
    for gid in ("main_0", "main_1"):
        d = json.loads((DATA / f"ep_{gid}.json").read_text(encoding="utf-8"))
        texts = set()
        for ep in d["episodes"]:
            for ln in ep["lines"]:
                if ln["zh"] in todo:
                    texts.add(ln["zh"])
        ch_lines[gid] = texts
    terms = json.loads((DATA / "terms.json").read_text(encoding="utf-8"))
    term_texts = {t["zh"] for c in terms["categories"] for s in c["sections"] for t in s["terms"]}
    vocab = json.loads((DATA / "vocab.json").read_text(encoding="utf-8"))
    vocab_texts = {v["w"] for v in vocab}

    # assign each text a home bucket
    home = {}
    for t in todo:
        if t in ch_lines["main_0"]:
            home[t] = "main_0"
        elif t in ch_lines["main_1"]:
            home[t] = "main_1"
        else:
            home[t] = "common"

    # move files
    new_map = {}
    missing = []
    for t in sorted(todo):
        src = AUDIO / fname(t)
        bucket = home[t]
        dst_dir = AUDIO / bucket
        dst_dir.mkdir(exist_ok=True)
        dst = dst_dir / fname(t)
        if src.exists():
            src.replace(dst)
        if dst.exists():
            new_map[t] = f"audio/{bucket}/{fname(t)}"
        else:
            missing.append(t)
    print(f"moved/mapped: {len(new_map)}  missing: {len(missing)}", file=sys.stderr)

    def size_of(url):
        return (ROOT / url).stat().st_size

    chapters = {}
    labels = {"main_0": "序章 音声", "main_1": "第1章 音声", "common": "用語・単語 音声"}
    needs = {
        "main_0": ch_lines["main_0"],
        "main_1": ch_lines["main_1"],
        "common": (term_texts | vocab_texts),
    }
    for cid, texts in needs.items():
        urls = sorted({new_map[t] for t in texts if t in new_map})
        chapters[cid] = {
            "label": labels[cid],
            "files": len(urls),
            "bytes": sum(size_of(u) for u in urls),
            "urls": urls,
        }
    buckets = {}
    for b in ("main_0", "main_1", "common"):
        files = list((AUDIO / b).glob("*.mp3")) if (AUDIO / b).exists() else []
        buckets[b] = {"files": len(files), "bytes": sum(f.stat().st_size for f in files)}

    manifest = {"buckets": buckets, "chapters": chapters,
                "totalBytes": sum(b["bytes"] for b in buckets.values())}
    (DATA / "audio_chapters.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    (DATA / "audio_map.json").write_text(
        json.dumps(new_map, ensure_ascii=False), encoding="utf-8")
    if missing:
        (ROOT / "audio_missing.json").write_text(
            json.dumps(missing, ensure_ascii=False), encoding="utf-8")
    for cid, c in chapters.items():
        print(f"{cid}: download set {c['files']} files, {c['bytes']/1e6:.1f} MB", file=sys.stderr)
    for b, v in buckets.items():
        print(f"bucket {b}: {v['files']} files, {v['bytes']/1e6:.1f} MB", file=sys.stderr)
    print(f"TOTAL audio: {manifest['totalBytes']/1e6:.1f} MB", file=sys.stderr)

if __name__ == "__main__":
    main()
