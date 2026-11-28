#!/usr/bin/env python3
"""Generate word-level TTS MP3s for seg words missing from data/audio_map.json.

Mirrors the layout of existing word clips: audio/common/<sha1(text)[:16]>.mp3
and the settings of scripts/gen_audio.py (voice avocado_v2:MAI_01, zh-CN,
speed 95 with 108/88 retries, >800 byte success check, stretched-take
duration rejection). audio_map.json is updated incrementally per batch.
"""
import hashlib, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TTS = "/opt/hatch/bin/tts"
VOICE = "avocado_v2:MAI_01"
MAP_PATH = ROOT / "data" / "audio_map.json"
STATE_PATH = ROOT / "scripts" / "word_audio_state.json"
BATCH = 200


def relpath(text):
    return "audio/common/" + hashlib.sha1(text.encode("utf-8")).hexdigest()[:16] + ".mp3"


def duration(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=20)
        return float(out.stdout.strip())
    except Exception:
        return None


def synth(text, out, speed):
    r = subprocess.run(
        [TTS, "speak", "--text", text, "--voice", VOICE, "--language", "zh-CN",
         "--speed", str(speed), "--output", str(out)],
        capture_output=True, text=True, timeout=120)
    return r.returncode == 0 and out.exists() and out.stat().st_size > 800


def one(text):
    rel = relpath(text)
    out = ROOT / rel
    if out.exists() and out.stat().st_size > 800:
        return (text, rel, "skip")
    limit = max(2.5, 1.0 + 0.55 * len(text))
    for speed in (95, 108, 88):
        try:
            if synth(text, out, speed):
                d = duration(out)
                if d is None or d <= limit:
                    return (text, rel, "ok")
        except Exception:
            pass
    return (text, rel, "fail")


def main():
    amap = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    words = set()
    for f in ["ep_main_0.json", "ep_main_1.json"]:
        d = json.loads((ROOT / "data" / f).read_text(encoding="utf-8"))
        for ep in d["episodes"]:
            for line in ep["lines"]:
                for seg in line.get("seg", []):
                    if seg[1]:
                        words.add(seg[0])
    missing = sorted(w for w in words if w not in amap)
    print(f"missing words: {len(missing)}", flush=True)
    (ROOT / "audio" / "common").mkdir(parents=True, exist_ok=True)
    ok = skip = 0
    failed = []
    for start in range(0, len(missing), BATCH):
        batch = missing[start:start + BATCH]
        with ThreadPoolExecutor(max_workers=6) as ex:
            for text, rel, st in ex.map(one, batch):
                if st in ("ok", "skip"):
                    amap[text] = rel
                    if st == "ok":
                        ok += 1
                    else:
                        skip += 1
                else:
                    failed.append(text)
        MAP_PATH.write_text(json.dumps(amap, ensure_ascii=False), encoding="utf-8")
        STATE_PATH.write_text(json.dumps(
            {"done": min(start + BATCH, len(missing)), "total": len(missing),
             "ok": ok, "skip": skip, "failed": failed}, ensure_ascii=False),
            encoding="utf-8")
        print(f"batch done {min(start+BATCH, len(missing))}/{len(missing)} "
              f"ok={ok} skip={skip} fail={len(failed)}", flush=True)
    print(f"DONE total={len(missing)} ok={ok} skip={skip} fail={len(failed)}", flush=True)


if __name__ == "__main__":
    main()
