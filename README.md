# アークナイツで学ぶ中国語（PWA版）

アークナイツ（明日方舟）本編の物語テキスト（中国語／日本語）を使って中国語を学ぶ、Duolingo風レッスンアプリの静的PWA版です。サーバー不要で、GitHub Pagesなどの静的ホスティングでそのまま動きます。

## 使い方（iPhone）

1. 公開URLを Safari で開く
2. 共有ボタン →「ホーム画面に追加」
3. ホーム画面のアイコンから全画面で起動できます

## 機能

- **ストーリーレッスン**: 序章（main_0・14話）＋第1章（main_1・12話）の実際の台詞から、文章ステージ（中→日／日→中 4択・10問・ハート制）と単語ステージ（聞き取り／単語→意味／意味→単語、一般語・固有名詞・専門用語バッジ付き）を交互に進むパス形式
- **用語ステージ**: キャラ名（所属別セクション）・専門用語・地理・団体の4カテゴリ、毎回ランダム10問
- **物語リーダー**: 中日対照で台詞を読みながら、単語タップでピンイン・品詞・意味を確認、音声再生も可能
- **解説**: 全台詞にピンインと単語分解（品詞カラー表示は設定でON/OFF）
- **記録**: XP・連続学習日数（ストリーク）・ステージ別ベスト・間違えた問題の復習キュー（すべて端末の localStorage に保存）
- **音声**: 中国語TTS音声をチャプター単位で管理。ホーム画面の各チャプター欄から「端末に保存」すると、その章の音声を Cache Storage にダウンロードしてオフライン再生でき、不要になったら削除できます

## データについて

- 台詞・用語データは公開ゲームデータ（Kengxxiao/ArknightsGameData［CN］、Kengxxiao/ArknightsGameData_YoStar［JP］）から生成しています。arkling（https://gggentooo.github.io/arkling/）と同じ公開データが元です
- 音声はMeta Shortwave TTS（中国語ボイス）で事前生成したMP3です
- 本アプリはファンメイドの学習用ツールで、Hypergryph／Yostar公式とは関係ありません

## 開発（データ再生成）

```bash
python3 -m venv venv && ./venv/bin/pip install jieba pypinyin edge-tts pillow
./venv/bin/python scripts/build_data.py     # data/*.json を生成（data-src/ に元データを用意）
./venv/bin/python scripts/gen_audio.py      # audio/*.mp3 を生成（環境の tts CLI を使用）
./venv/bin/python scripts/layout_audio.py   # 音声をチャプター別フォルダに整理し audio_chapters.json を生成
./venv/bin/python scripts/make_icons.py     # アイコン生成
python3 -m http.server 8000                 # ローカル確認
```

詳しい収録範囲と容量は `BUILD-NOTES.md` を参照してください。
