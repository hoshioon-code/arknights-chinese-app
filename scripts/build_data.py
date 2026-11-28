#!/usr/bin/env python3
"""Build static data JSON for the Arknights Chinese PWA from public game data.

Sources (public ArknightsGameData repos, same data arkling uses):
  CN: Kengxxiao/ArknightsGameData        (zh_CN)
  JP: Kengxxiao/ArknightsGameData_YoStar (ja_JP)
Outputs: data/meta.json, data/ep_main_0.json, data/ep_main_1.json,
         data/terms.json, data/vocab.json, data/audio_map.json, data/audio_todo.json
"""
import hashlib, json, re, sys
from collections import Counter, OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glosses import GLOSSES

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-src"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

NAME_RE = re.compile(r'^\[name="([^"]*)"\]\s*(.*)$')
TAG_RE = re.compile(r"<[^>]+>")
CJK_RE = re.compile(r"[一-鿿]")

POS_MAP = {
    "n": ("名詞", "noun"), "nz": ("名詞", "noun"), "l": ("名詞", "noun"),
    "nr": ("名詞", "noun"), "ns": ("名詞", "noun"), "nt": ("名詞", "noun"),
    "t": ("名詞", "noun"), "s": ("名詞", "noun"),
    "v": ("動詞", "verb"), "vn": ("動詞", "verb"), "vd": ("動詞", "verb"), "vg": ("動詞", "verb"),
    "a": ("形容詞", "adj"), "ad": ("形容詞", "adj"), "an": ("形容詞", "adj"), "ag": ("形容詞", "adj"),
    "d": ("副詞", "adv"), "dg": ("副詞", "adv"),
    "r": ("代名詞", "pron"), "rr": ("代名詞", "pron"), "rz": ("代名詞", "pron"),
}
def pos_of(flag):
    return POS_MAP.get(flag, ("その他", "other"))

# ---------------------------------------------------------------- terms
def load_json(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))

team_zh = load_json(SRC / "handbook_team_table_zh.json")
team_jp = load_json(SRC / "handbook_team_table_jp.json")
char_zh = load_json(SRC / "character_table_zh.json")
char_jp = load_json(SRC / "character_table_jp.json")
item_zh = load_json(SRC / "item_table_zh.json")["items"]
item_jp = load_json(SRC / "item_table_jp.json")["items"]

PLACES = [
    ("龙门", "龍門"), ("乌萨斯", "ウルサス"), ("拉特兰", "ラテラーノ"), ("卡兹戴尔", "カズデル"),
    ("维多利亚", "ヴィクトリア"), ("哥伦比亚", "クルビア"), ("莱塔尼亚", "リターニア"),
    ("叙拉古", "シラクーザ"), ("伊比利亚", "イベリア"), ("萨米", "サーミ"), ("谢拉格", "イェラグ"),
    ("米诺斯", "ミノス"), ("萨尔贡", "サルゴン"), ("玻利瓦尔", "ボリバル"), ("东国", "ヒガシ"),
    ("大炎", "大炎"), ("雷姆必拓", "レム・ビリトン"), ("阿戈尔", "エーギル"), ("杜林", "ドゥリン"),
    ("卡西米尔", "カジミエシュ"), ("切尔诺伯格", "チェルノボーグ"), ("罗德岛", "ロドス"),
]

def aff_name(aff_id, lang_table):
    t = lang_table.get(aff_id)
    return t["powerName"] if t else None

# characters grouped by affiliation
char_by_aff = OrderedDict()
seen_names = set()
for cid, c in char_zh.items():
    if not cid.startswith("char_"):
        continue
    name = (c.get("name") or "").strip()
    jp = char_jp.get(cid, {})
    jname = (jp.get("name") or "").strip()
    if not name or not jname or name in seen_names:
        continue
    if c.get("profession") in ("TOKEN", "TRAP"):
        continue
    seen_names.add(name)
    mp = c.get("mainPower") or {}
    aff = mp.get("teamId") or mp.get("groupId") or mp.get("nationId") or "other"
    char_by_aff.setdefault(aff, []).append({"zh": name, "jp": jname, "kind": "proper"})

def chunk(lst, n=30):
    return [lst[i:i + n] for i in range(0, len(lst), n)]

categories = []

# --- operator category (sections by affiliation, <=30 each)
op_sections = []
for aff, terms in sorted(char_by_aff.items(), key=lambda kv: -len(kv[1])):
    terms_sorted = sorted(terms, key=lambda t: t["zh"])
    name_zh = aff_name(aff, team_zh) or "其他"
    name_jp = aff_name(aff, team_jp) or "その他"
    parts = chunk(terms_sorted)
    for i, part in enumerate(parts):
        suffix = f" {i+1}" if len(parts) > 1 else ""
        op_sections.append({
            "id": f"op:{aff}:{i}", "name": name_zh + suffix, "nameJp": name_jp + suffix,
            "terms": part,
        })
categories.append({"id": "operator", "label": "キャラ名", "labelZh": "干员名", "sections": op_sections})

# --- glossary category (materials + currency/tickets)
materials, currency = [], []
CUR_IDS = {"4001", "4002", "4003", "4004", "4005", "7001", "7002", "7003", "7004"}
for iid, it in item_zh.items():
    jname = (item_jp.get(iid, {}).get("name") or "").strip()
    name = (it.get("name") or "").strip()
    if not name or not jname:
        continue
    if iid in CUR_IDS:
        currency.append({"zh": name, "jp": jname, "kind": "term"})
    elif it.get("itemType") == "MATERIAL" and iid.isdigit():
        materials.append({"zh": name, "jp": jname, "kind": "term"})
materials = sorted({m["zh"]: m for m in materials}.values(), key=lambda t: t["zh"])
gl_sections = []
for i, part in enumerate(chunk(materials)):
    gl_sections.append({"id": f"gl:mat:{i}", "name": f"素材 {i+1}", "nameJp": f"素材 {i+1}", "terms": part})
gl_sections.append({"id": "gl:cur:0", "name": "通貨・チケット", "nameJp": "通貨・チケット",
                    "terms": sorted(currency, key=lambda t: t["zh"])})
categories.append({"id": "glossary", "label": "専門用語", "labelZh": "术语", "sections": gl_sections})

# --- places
categories.append({"id": "place", "label": "地理", "labelZh": "地理", "sections": [
    {"id": "place:0", "name": "地理", "nameJp": "地理",
     "terms": [{"zh": z, "jp": j, "kind": "proper"} for z, j in PLACES]},
]})

# --- organizations (handbook teams, excluding none and pure-affiliation dupes are fine)
org_terms = []
for pid, t in team_zh.items():
    if pid == "none":
        continue
    jn = (team_jp.get(pid, {}).get("powerName") or "").strip()
    if jn:
        org_terms.append({"zh": t["powerName"], "jp": jn, "kind": "term"})
org_terms = sorted({o["zh"]: o for o in org_terms}.values(), key=lambda t: t["zh"])
categories.append({"id": "org", "label": "団体", "labelZh": "势力", "sections": [
    {"id": "org:0", "name": "団体", "nameJp": "団体", "terms": org_terms},
]})

terms_data = {"categories": categories}
term_counts = {c["id"]: sum(len(s["terms"]) for s in c["sections"]) for c in categories}
print("terms:", term_counts, "total:", sum(term_counts.values()), file=sys.stderr)

# term gloss lookup (word -> jp) for segment glosses + userdict
term_gloss = {}
for c in categories:
    for s in c["sections"]:
        for t in s["terms"]:
            term_gloss[t["zh"]] = t["jp"]

# ---------------------------------------------------------------- jieba setup
import jieba
import jieba.posseg as posseg
from pypinyin import pinyin as py_pinyin, Style
jieba.setLogLevel(60)
for c in categories:
    for s in c["sections"]:
        for t in s["terms"]:
            tag = "nr" if c["id"] == "operator" else ("ns" if c["id"] == "place" else "nt" if c["id"] == "org" else "nz")
            jieba.add_word(t["zh"], freq=100000, tag=tag)
for w in ["整合运动", "源石", "矿石病", "感染者", "天灾", "干员", "切尔诺伯格", "罗德岛"]:
    jieba.add_word(w, freq=100000)

# add pinyin to every term, then write terms.json
for c in categories:
    for s in c["sections"]:
        for t in s["terms"]:
            t["py"] = "".join(x[0] for x in py_pinyin(t["zh"], style=Style.TONE, heteronym=False))
(DATA / "terms.json").write_text(json.dumps(terms_data, ensure_ascii=False), encoding="utf-8")

def line_pinyin(segs):
    out = ""
    for w, py, flag in segs:
        cls = pos_of(flag)[1]
        if cls == "other" and not py:
            out += w
        else:
            out += (" " if out and not out.endswith(" ") else "") + py
    return out.strip()

def segment_line(text):
    segs = []
    for w, flag in posseg.cut(text):
        if w.strip() == "":
            continue
        if CJK_RE.search(w) or re.search(r"[A-Za-z0-9]", w):
            py = "".join(s[0] for s in py_pinyin(w, style=Style.TONE, heteronym=False))
        else:
            py = ""
        segs.append((w, py, flag))
    return segs

# ---------------------------------------------------------------- episodes
def parse_script(path):
    lines = []
    for raw in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        m = NAME_RE.match(raw.strip())
        if not m:
            continue
        text = TAG_RE.sub("", m.group(2)).replace("{nickname}", "博士").strip()
        if text:
            lines.append({"speaker": m.group(1), "text": text})
    return lines

review_zh = load_json(SRC / "story_review_zh.json")
review_jp = load_json(SRC / "story_review_jp.json")

meta = {"chapters": []}
word_freq = Counter()
word_example = {}  # word -> (ep_id, line_idx)
audio_texts = set()

for gid in ("main_0", "main_1"):
    g_zh, g_jp = review_zh[gid], review_jp[gid]
    jp_by_txt = {e["storyTxt"]: e for e in g_jp["infoUnlockDatas"]}
    episodes = []
    seen_txt = set()
    for e in sorted(g_zh["infoUnlockDatas"], key=lambda x: x["storySort"]):
        txt = e["storyTxt"]
        if txt in seen_txt:
            continue
        seen_txt.add(txt)
        fn = txt.replace("/", "_") + ".txt"
        zh_lines = parse_script(SRC / "story_zh" / fn)
        jp_lines = parse_script(SRC / "story_jp" / fn)
        je = jp_by_txt.get(txt, {})
        ep_id = txt.replace("/", "_")
        lines_out = []
        for i, (a, b) in enumerate(zip(zh_lines, jp_lines)):
            segs = segment_line(a["text"])
            seg_out = []
            for w, py, flag in segs:
                label, cls = pos_of(flag)
                row = [w, py, cls]
                gloss = GLOSSES.get(w) or term_gloss.get(w)
                if gloss:
                    row.append(gloss)
                seg_out.append(row)
                if len(w) >= 2 and CJK_RE.search(w):
                    word_freq[w] += 1
                    word_example.setdefault(w, (ep_id, i))
            lines_out.append({
                "sp": a["speaker"], "spJp": b["speaker"],
                "zh": a["text"], "jp": b["text"],
                "py": line_pinyin(segs), "seg": seg_out,
            })
            if CJK_RE.search(a["text"]) and len(a["text"]) <= 110:
                audio_texts.add(a["text"])
        episodes.append({
            "id": ep_id, "code": e.get("storyCode") or "",
            "name": e["storyName"], "nameJp": je.get("storyName", e["storyName"]),
            "tag": e.get("avgTag") or "", "lines": lines_out,
        })
        print(f"{gid} {txt}: {len(lines_out)} lines", file=sys.stderr)
    (DATA / f"ep_{gid}.json").write_text(
        json.dumps({"chapter": gid, "episodes": episodes}, ensure_ascii=False), encoding="utf-8")
    meta["chapters"].append({
        "id": gid, "name": g_zh["name"], "nameJp": g_jp["name"],
        "file": f"data/ep_{gid}.json",
        "episodes": [{"id": ep["id"], "code": ep["code"], "name": ep["name"],
                      "nameJp": ep["nameJp"], "tag": ep["tag"],
                      "lineCount": len(ep["lines"])} for ep in episodes],
    })

(DATA / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

# ---------------------------------------------------------------- vocab
vocab = []
for w, cnt in word_freq.most_common(600):
    gloss = GLOSSES.get(w) or term_gloss.get(w)
    if not gloss or cnt < 4:
        continue
    ep_id, li = word_example[w]
    kind = "general"
    if w in term_gloss:
        kind = "term" if w not in {t["zh"] for c in categories if c["id"] == "operator" for s in c["sections"] for t in s["terms"]} else "proper"
    py = "".join(s[0] for s in py_pinyin(w, style=Style.TONE, heteronym=False))
    vocab.append({"w": w, "py": py, "gloss": gloss, "kind": kind, "freq": cnt,
                  "exEp": ep_id, "exLine": li})
    audio_texts.add(w)
    if len(vocab) >= 200:
        break
(DATA / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False), encoding="utf-8")
print("vocab:", len(vocab), file=sys.stderr)

# ---------------------------------------------------------------- audio map
for c in categories:
    for s in c["sections"]:
        for t in s["terms"]:
            audio_texts.add(t["zh"])
audio_map = {}
for t in sorted(audio_texts):
    h = hashlib.sha1(t.encode("utf-8")).hexdigest()[:16]
    audio_map[t] = f"audio/{h}.mp3"
(DATA / "audio_map.json").write_text(json.dumps(audio_map, ensure_ascii=False), encoding="utf-8")
(DATA / "audio_todo.json").write_text(json.dumps(sorted(audio_texts), ensure_ascii=False), encoding="utf-8")
print("audio clips to generate:", len(audio_texts), file=sys.stderr)
