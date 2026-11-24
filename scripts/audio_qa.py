#!/usr/bin/env python3
"""ASR QA for generated TTS clips.

Phase 1: ffprobe durations for every clip in data/audio_map.json.
Phase 2: faster-whisper transcription (language=zh) of every clip,
         saved incrementally to /tmp/asr_results.json.
Phase 3: flag clips whose normalized transcription mismatches the source
         text, plus duration outliers. Writes /tmp/qa_flags.json.
"""
import json, re, subprocess, sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent.parent
RESULTS = Path("/tmp/asr_results.json")
FLAGS = Path("/tmp/qa_flags.json")
MODEL_SIZE = sys.argv[1] if len(sys.argv) > 1 else "small"

amap = json.loads((ROOT / "data" / "audio_map.json").read_text(encoding="utf-8"))
items = sorted(amap.items())  # (text, relpath)
print(f"clips: {len(items)}", flush=True)

def probe(rel):
    p = ROOT / rel
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                              "-of", "csv=p=0", str(p)], capture_output=True, text=True, timeout=20)
        return rel, float(out.stdout.strip())
    except Exception:
        return rel, None

durations = {}
with ThreadPoolExecutor(max_workers=8) as ex:
    for rel, d in ex.map(probe, [r for _, r in items]):
        durations[rel] = d
print("durations done", flush=True)

results = {}
if RESULTS.exists():
    results = json.loads(RESULTS.read_text(encoding="utf-8"))
todo = [(t, r) for t, r in items if r not in results]
print(f"ASR todo: {len(todo)} (already {len(results)})", flush=True)

if todo:
    from faster_whisper import WhisperModel
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    print(f"model {MODEL_SIZE} loaded", flush=True)
    for i, (text, rel) in enumerate(todo):
        try:
            segs, _info = model.transcribe(str(ROOT / rel), language="zh", beam_size=1,
                                           condition_on_previous_text=False)
            results[rel] = "".join(s.text for s in segs).strip()
        except Exception as e:
            results[rel] = f"__ERROR__ {e}"
        if (i + 1) % 50 == 0:
            RESULTS.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
            print(f"ASR {i+1}/{len(todo)}", flush=True)
    RESULTS.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
print("ASR done", flush=True)

# ---------- analysis ----------
PUNCT = re.compile(r"[\s，。！？、；：·…—\-「」『』（）()【】\"'“”‘’.,!?;:~@{}<>*#\dA-Za-z]+")
try:
    from opencc import OpenCC
    _t2s = OpenCC("t2s")
    def _conv(s):
        return _t2s.convert(s)
except Exception:
    def _conv(s):
        return s
def norm(s):
    return PUNCT.sub("", _conv(s or ""))

def sim(a, b):
    if not a or not b:
        return 0.0
    import difflib
    return difflib.SequenceMatcher(None, a, b).ratio()

# duration stats by length class
import statistics
by_len = {}
for text, rel in items:
    d = durations.get(rel)
    if d:
        by_len.setdefault(len(text), []).append(d / max(1, len(text)))
med_spc = {k: statistics.median(v) for k, v in by_len.items() if len(v) >= 5}
global_med = statistics.median([d / max(1, len(t)) for t, r in items if durations.get(r)])

flags = []
for text, rel in items:
    src = norm(text)
    heard = norm(results.get(rel, ""))
    reasons = []
    if results.get(rel, "").startswith("__ERROR__"):
        reasons.append("asr_error")
    elif heard != src:
        ok = False
        if src and heard and (src in heard or heard in src):
            ok = True
        elif sim(src, heard) >= 0.8:
            ok = True
        if not ok:
            reasons.append(f"asr_mismatch sim={sim(src, heard):.2f} heard={heard[:40]}")
    d = durations.get(rel)
    if d:
        spc = d / max(1, len(text))
        med = med_spc.get(len(text), global_med)
        if med > 0 and (spc > med * 2.2 or spc < med * 0.4) and abs(d - med * len(text)) > 1.2:
            reasons.append(f"duration_outlier spc={spc:.2f} med={med:.2f} dur={d:.1f}")
    if reasons:
        flags.append({"text": text, "path": rel, "duration": d, "heard": results.get(rel, ""), "reasons": reasons})

FLAGS.write_text(json.dumps({"model": MODEL_SIZE, "checked": len(items), "flags": flags},
                            ensure_ascii=False, indent=1), encoding="utf-8")
print(f"FLAGS: {len(flags)} / {len(items)}", flush=True)
