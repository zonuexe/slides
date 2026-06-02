---
name: pdf-publish
description: tadsan の slides リポジトリ (VitePress) で新しい発表登壇 PDF を公開する標準手順。元PDFを `pdf/YYYYMMDD_slug.pdf` に配置し、サムネイル PNG と本文/リンクメタ YAML を生成し、`slides.yaml` 先頭に新規エントリを追加して、VitePress ビルドが通る状態に持っていく。「スライドを公開」「発表資料を追加」「PDF を publish」「slides.yaml に新しい登壇を載せる」「新しい資料をサイトに反映」のような依頼が来たら、たとえ明示的にスキル名が呼ばれていなくても、自動化スクリプトと手動フォールバック (Ghostscript 不在時の pypdfium2 ルートを含む) の両方を理解しているこの SKILL を必ず参照すること。
---

# PDF Publish

新しい発表資料 PDF を 1 本受け取って、サイトに公開できる状態まで持っていくための手順。

## ゴール

master ブランチに次の 4 点が揃った状態にする:

- `pdf/<slug>.pdf` — リネーム済みの本体
- `pdf/<slug>.png` — 1200x630 のサムネイル
- `pdf/<slug>.yaml` — `text` / `links` / `size` を含むメタ
- `slides.yaml` の先頭に追加された新規エントリ

ここまで揃えば一覧ページ、詳細ページ、OGP がすべて成立する。

## 1. slug を決めて PDF を配置する

slug の方針:

- 先頭は発表日 `YYYYMMDD` (slug 日付と `slides.yaml` の `date` がずれると並び順と検索結果が崩れる)
- 後半は内容を端的に表す英数 kebab-case
- 英語副題の丸写しよりも、話題が伝わる名前を優先する

中身を確認するためのコマンド (macOS には `pdfinfo` / `pdftotext` が入っていないことが多いので pdfminer を使う):

```bash
UV_CACHE_DIR=.uv-cache uv run --project script python -c "
from pdfminer.high_level import extract_text
print(extract_text('元ファイル.pdf', maxpages=2))
"
```

1 ページ目には大抵 `タイトル / 副題 / 日付 #hashtag / 都道府県市区町村 会場名` が並んでいる。ここから slug、`date`、`hashtags`、`events` のかなりの部分を機械的に決められる。

決めたら所定の場所に移動する:

```bash
mv "元ファイル.pdf" pdf/<slug>.pdf
```

## 2. 自動化スクリプトを回す

```bash
UV_CACHE_DIR=.uv-cache uv run --project script python script/add_new_slides.py --pdf pdf/<slug>.pdf
```

成功するとこれらが揃う:

- `pdf/<slug>.png`
- `pdf/<slug>.yaml`
- `slides.yaml` の先頭に最低限の新規エントリ (title / date / file / meta / download / image / 検出された hashtags)

スクリプトは内部で順に:

1. `magick convert` で 1 ページ目を 1200x630 PNG に
2. `zopflipng` があれば PNG を再圧縮
3. `pdf_text_extractor.py` で本文を YAML 化
4. `pdf_link_extractor.py` でハイパーリンクを既存 YAML にマージ
5. `slides.yaml` の先頭にエントリを差し込む

を流す。**(1) のサムネイル生成が落ちると以降の手順まで走らない** ので、その場合は §3 でバラバラに再現する。

## 3. 自動化が落ちたときのフォールバック

代表的な詰まりどころは ImageMagick の PDF ラスタライズ。`magick convert` は内部で Ghostscript (`gs`) を呼ぶため、`gs` が入っていない macOS では `FailedToExecuteCommand 'gs'` で死ぬ。Ghostscript を入れるなら `brew install ghostscript` で済むが、入れたくない場合 (CI / 一時環境 / 依存を増やしたくない) は次の手順で個別に作る。**ここで作るファイル名・サイズ・形式は §2 のスクリプト出力と同等にする** こと。後続の build はファイルの存在しか見ない。

### 3-1. サムネイル PNG を pypdfium2 で作る

`pypdfium2` と Pillow は script venv にすでに入っている (`script/pyproject.toml` の dependency)。

```bash
UV_CACHE_DIR=.uv-cache uv run --project script python -c "
import pypdfium2 as pdfium
from PIL import Image
pdf = pdfium.PdfDocument('pdf/<slug>.pdf')
img = pdf[0].render(scale=200/72).to_pil()
img.thumbnail((1200, 630))
bg = Image.new('RGB', img.size, 'white')
bg.paste(img, mask=img.split()[3] if img.mode == 'RGBA' else None)
bg.save('pdf/<slug>.png', 'PNG')
"
```

その後 `zopflipng` で再圧縮 (任意だがリポジトリの慣例で、PNG は zopflipng 通したサイズになっている):

```bash
zopflipng -m -y pdf/<slug>.png /tmp/<slug>.png && mv /tmp/<slug>.png pdf/<slug>.png
```

### 3-2. text / links 抽出だけ個別に走らせる

サムネイル失敗で add_new_slides.py が中断した場合、後段の text/link extractor まで走っていない。順番は **text → link** にする。link extractor は既存 YAML をマージ更新する作りなので、空の YAML から始めても安全。

```bash
touch pdf/<slug>.yaml
UV_CACHE_DIR=.uv-cache uv run --project script python script/pdf_text_extractor.py pdf/<slug>.pdf
UV_CACHE_DIR=.uv-cache uv run --project script python script/pdf_link_extractor.py \
  --update-meta --meta-file pdf/<slug>.yaml pdf/<slug>.pdf
```

仕上がり YAML には少なくとも `text` (各ページ p1/p2... の段落配列)、`links`、`size` が入る。**`text` が空のまま build が通ると詳細ページが描画されない**ので必ず目視する。

### 3-3. slides.yaml は手で追記する

スクリプトが落ちると slides.yaml の最終更新ステップも走らないので、自分で先頭に書き足す。最低限は §4 のテンプレートをそのまま使う。

## 4. `slides.yaml` を整える

スクリプトが自動で入れるのは title / date / file / meta / download / image / (検出された) hashtags まで。`events` 以下は人間が補う。最低限のテンプレート:

```yaml
<slug>:
  title: 発表タイトル
  date: 'YYYY-MM-DD'
  file: pdf/<slug>.pdf
  meta: pdf/<slug>.yaml
  download: YYYYMMDD_発表タイトル.pdf
  image: pdf/<slug>.png
  hashtags:
  - イベントハッシュタグ
  events:
  - name: イベント名
    url: https://example.com/
    location: 都道府県市区町村
    place: 会場名
    presented_at: 'YYYY-MM-DD'
    type: レギュラーセッション
    talk_duration: 30
  tags:
  - lang:PHP
```

ポイント:

- **`download` は静的サイトから DL されるときのファイル名で、日本語 OK**。リポジトリ慣例は `YYYYMMDD_日本語タイトル.pdf`
- 1 ページ目の `#hashtag YYYY-MM-DD 都道府県市区町村 会場名` 行から `events` をほぼ機械的に埋められる
- `type` (`レギュラーセッション` / `ライトニングトーク` / `LT` 等) と `talk_duration` はスライドだけからは確定しない。確証がなければ推測値を入れた上で、ユーザーに「要確認」と伝える
- 同じイベントの過去エントリを `grep <イベントhashtag> slides.yaml` で引くと、フィールドの埋め方が真似できる
- 必要に応じて `related_articles` (関連記事 url/title/desc) を足す

## 5. 動作確認

YAML がパースできるか:

```bash
node -e "import('./lib/slides.js').then(m => m.loadSlides()).then(s => console.log(Object.keys(s)[0]))"
```

初回は `node_modules` がないので、先に `npm install` する。`package-lock.json` はリポジトリで管理されているので、更新があれば一緒にコミットする。

サイト生成:

```bash
npm run build
```

成功すると `docs/.vitepress/dist/pdf/<slug>.{pdf,png,yaml}` と `docs/.vitepress/dist/<slug>/` が出る。実物を見たいときは `npm run dev`。

## 6. コミット前チェック

```bash
git status -sb
```

期待される変化:

- 新規: `pdf/<slug>.pdf` / `pdf/<slug>.png` / `pdf/<slug>.yaml`
- 変更: `slides.yaml` (および `npm install` を回したなら `package-lock.json`)
- 出てきても無視: `.uv-cache/` (uv キャッシュ、gitignore 済)

ユーザーから明示的に依頼されない限り、勝手にコミットしない。

## 7. 反映ブランチ

- `master`: PDF / PNG / YAML / `slides.yaml` / 実装変更すべて
- `gh-pages`: 公開ビルド出力 (`docs/.vitepress/dist`)。通常は CI が反映するので触らない

## 8. よくある詰まりどころ

- **`gs not found`**: §3 のフォールバック、または `brew install ghostscript`。CI など環境を汚せない場合は pypdfium2 ルート一択
- **PDF を手動 mv した後、git の古いパスが staged で残る**: `git status` で確認、必要なら `git restore --staged <old>` で剥がす
- **`pdf/<slug>.yaml` が空のまま build が通る**: 詳細ページが描画されない。`text:` セクションがあるか必ず目視
- **slug の `YYYYMMDD` と `slides.yaml` の `date` がずれている**: 並び順と検索が崩れる
- **`events` 未記入**: 致命ではないが、詳細ページの description がサイト既定値にフォールバックして OGP が弱くなる
- **`download` のファイル名がしょぼい**: ブラウザでの DL 時にそのまま使われる。タイトル日本語を含めて読み手にとってわかりやすい名前にする
