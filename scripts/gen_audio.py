#!/usr/bin/env python3
"""Generate Chinese TTS MP3s for all texts in data/audio_todo.json.

Uses the environment's built-in TTS CLI (/opt/hatch/bin/tts, Meta Shortwave),
voice avocado_v2:MAI_01 at speed 95 (~64kbps MP3).
Abnormally long takes (a known failure mode: stretched audio) are rejected
and regenerated at a different speed.
"""
import hashlib, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TTS = "/opt/hatch/bin/tts"
VOICE = "avocado_v2:MAI_01"

def fname(text):
    return ROOT / "audio" / (hashlib.sha1(text.encode("utf-8")).hexdigest()[:16] + ".mp3")

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
    out = fname(text)
    if out.exists() and out.stat().st_size > 800:
        return (text, "skip")
    limit = max(2.5, 1.0 + 0.55 * len(text))
    for speed in (95, 108, 88):
        try:
            if synth(text, out, speed):
                d = duration(out)
                if d is None or d <= limit:
                    return (text, "ok")
        except Exception:
            pass
    return (text, "fail")

def main():
    texts = json.loads((ROOT / "data" / "audio_todo.json").read_text(encoding="utf-8"))
    (ROOT / "audio").mkdir(exist_ok=True)
    ok = skip = fail = 0
    failed = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for i, (text, st) in enumerate(ex.map(one, texts)):
            if st == "ok":
                ok += 1
            elif st == "skip":
                skip += 1
            else:
                fail += 1
                failed.append(text)
            if (i + 1) % 200 == 0:
                print(f"{i+1}/{len(texts)} ok={ok} skip={skip} fail={fail}", flush=True)
    print(f"DONE total={len(texts)} ok={ok} skip={skip} fail={fail}", flush=True)
    if failed:
        (ROOT / "audio_failed.json").write_text(
            json.dumps(failed, ensure_ascii=False), encoding="utf-8")

if __name__ == "__main__":
    main()
