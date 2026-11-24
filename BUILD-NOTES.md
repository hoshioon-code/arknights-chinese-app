# BUILD-NOTES — アークナイツで学ぶ中国語（PWA版）

Built 2026-11-24 as a fully static site (no server) for GitHub Pages hosting.

## Bundled scope

| Item | Count |
|---|---|
| Chapters | 序章 main_0（14 episodes）+ 第1章 main_1（12 episodes） |
| Story lines (CN/JP pairs) | 1,552（alignment mismatches: 0） |
| Terms total | 562（キャラ名 392 / 専門用語 104 / 地理 22 / 団体 44） |
| Term sections | 52（キャラ名は所属別45、専門用語5、地理1、団体1） |
| Vocab words (word lessons, with JP glosses) | 200 |
| Audio clips generated | 2,120 / 2,122 attempted |

Data sources: Kengxxiao/ArknightsGameData (zh_CN) and Kengxxiao/ArknightsGameData_YoStar (ja_JP) — the same public game data arkling uses. Explanations (pinyin + word segmentation + part of speech) were pre-generated with jieba + pypinyin; word glosses for the 200 vocab words were hand-authored in `scripts/glosses.py`, term glosses are the official JP names from the game data. Audio: Meta Shortwave TTS via the environment's `tts` CLI, voice `avocado_v2:MAI_01`, speed 95, ~64kbps MP3; abnormally long takes are auto-rejected and regenerated at other speeds (see `scripts/gen_audio.py`).

## Audio layout & sizes (the rotation-planning numbers)

Audio is stored per chapter bucket and described in `data/audio_chapters.json`:

| Bucket | Physical files | Physical size | In-app download set |
|---|---|---|---|
| `audio/main_0/` （序章） | 781 | 21.6 MB | 781 files / 21.6 MB |
| `audio/main_1/` （第1章） | 604 | 15.0 MB | 615 files / 15.2 MB |
| `audio/common/` （用語・単語） | 735 | 6.9 MB | 735 files / 6.9 MB |
| **Total audio** | **2,120** | **43.5 MB** | |

- The main_1 download set (615) is slightly larger than its physical bucket (604): 11 clips are lines shared with main_0 and physically stored once under `audio/main_0/`; the main_1 manifest lists those URLs too, so downloading 第1章 alone still caches everything its lessons need.
- Rule of thumb for future chapters: **≈1.5 MB of audio per episode, ≈15–22 MB per chapter** (12–14 episodes).
- Whole publishable site today: **≈47.6 MB** (audio 43.5 MB + data JSON ≈1.2 MB + app/icons ≈0.2 MB + scripts/docs). That is under 5% of the GitHub Pages 1 GB site limit — at ~18 MB per chapter, roughly **50 more chapters** of audio would fit before rotation is necessary.

### Rotating chapters in/out later

- Add a chapter: generate its data + audio, run `scripts/layout_audio.py`, publish the new bucket folder and updated `data/*.json`.
- Remove a chapter's audio (to reclaim space): delete its `audio/<chapter>/` folder AND remove that chapter's entries from `data/audio_map.json` and `data/audio_chapters.json` (otherwise dead audio buttons remain). Lessons themselves keep working without audio.
- In-app, users manage device storage per chapter: ホーム画面の各チャプター欄「端末に保存／削除」→ Cache Storage (`akcn-audio-<chapterId>`). Playback checks all caches first (via the service worker), then streams from the network; streamed audio is never auto-stored.

## Known gaps / cuts

- **2 clips missing**: the TTS refused 「濯尘芙蓉」 (skin name) and 「钼铅」 (material) after repeated attempts. Those two terms simply show no audio button.
- **Operator terms 392** (the Muse Space has 415): this build dedupes by name and requires an official JP name from the JP character table, which drops some NPC/variant entries.
- **5 tiny affiliation sections** （ウルサスの一部・S.W.E.E.P. 等， <4 terms) produce 6–9-question lessons instead of 10, because questions are unique term×format combinations.
- **No character illustrations**: unlike the Muse Space, this public-repo version deliberately bundles no game artwork (icons are original geometric designs).
- **No dynamic word highlighting during audio playback** (the Muse Space has an estimated version); sentence audio is a single MP3 per line with no word timestamps.
- Haptics are not implemented (impossible from a web page on iOS — same conclusion as the Space).
- Learning data (XP/streak/progress/mistakes) is per-device localStorage and does not sync with the Muse Space version.

## Verification performed

- Local `python http.server`: index, CSS, JS, manifest, SW, all data JSON and sample MP3s from every bucket return 200.
- `node --check` passes for `app.js` and `sw.js`; all data JSON parses.
- Data-side simulation of the lesson builders: every episode yields a full 10-question sentence pool and ≥10 glossed words; every term section can build a lesson.
- Every URL in `audio_map.json` / `audio_chapters.json` exists on disk (0 missing).
