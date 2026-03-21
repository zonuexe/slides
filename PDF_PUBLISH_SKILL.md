# PDF Publish Skill

このリポジトリで新しい発表資料 PDF を公開するまでの標準手順。

## 1. 原稿を配置する

1. 元の PDF をリポジトリ直下に置く。
2. 中身を見て、`YYYYMMDD_topic-slug` 形式の slug を決める。
3. PDF を `pdf/<slug>.pdf` に移動する。

slug の方針:

- 先頭は発表日 `YYYYMMDD`
- 後半は内容を端的に表す kebab-case
- 英語副題の丸写しより、話題が伝わる名前を優先する

確認に使うコマンド:

```bash
pdfinfo "元ファイル.pdf" | head
pdftotext -enc UTF-8 -layout -f 1 -l 1 "元ファイル.pdf" - | head -n 20
```

## 2. 生成物を作る

標準手順:

```bash
UV_CACHE_DIR=.uv-cache uv run python script/add_new_slides.py --pdf pdf/<slug>.pdf
```

このコマンドで以下が揃う:

- `pdf/<slug>.png`
- `pdf/<slug>.yaml`
- `slides.yaml` の先頭への新規追加

## 3. 自動化が失敗したときのフォールバック

`uv` や抽出スクリプトが落ちる場合は、最低限これを手で作る。

サムネイル:

```bash
magick convert -quiet -density 200 'pdf/<slug>.pdf[0]' \
  -thumbnail '1200x630>' \
  -strip \
  -background white \
  -alpha remove \
  -alpha off \
  png32:pdf/<slug>.png
```

`zopflipng` があれば圧縮:

```bash
zopflipng -m -y pdf/<slug>.png /tmp/<slug>.png && mv /tmp/<slug>.png pdf/<slug>.png
```

YAML は `pdfinfo` と `pdftotext` を使って生成する。最低限必要なのは:

- `size.max_width`
- `size.max_height`
- `links`
- `text`

各ページを `p1`, `p2`... として保持し、各行を `node: p` の配列にしておけば一覧検索と詳細ページ描画は動く。

## 4. `slides.yaml` を整える

先頭に新しいエントリを追加する。

最低限の項目:

```yaml
<slug>:
  title: 発表タイトル
  date: 'YYYY-MM-DD'
  file: pdf/<slug>.pdf
  meta: pdf/<slug>.yaml
  download: 'YYYYMMDD_発表タイトル.pdf'
  image: pdf/<slug>.png
```

必要に応じて追加:

- `hashtags`
- `events`
- `tags`
- `related_articles`

`events` の推奨項目:

```yaml
events:
- name: イベント名
  url: https://example.com/
  location: 都道府県市区町村
  place: 会場名
  presented_at: 'YYYY-MM-DD'
  type: レギュラーセッション
  talk_duration: 30
```

## 5. ローカル確認

YAML 構文確認:

```bash
node -e "import('./lib/slides.js').then(m => m.loadSlides())"
```

サイト生成確認:

```bash
npm run build
```

必要ならローカルプレビュー:

```bash
npm run dev
npm run preview
```

## 6. 反映対象ブランチ

- `master`: PDF, PNG, YAML, `slides.yaml`, 実装変更
- `gh-pages`: `npm run build` の出力を反映する場合の公開用ブランチ

このリポジトリは VitePress 構成なので、公開物は `docs/.vitepress/dist` に出る。

## 7. コミット前チェック

追加・更新されているべきもの:

- `pdf/<slug>.pdf`
- `pdf/<slug>.png`
- `pdf/<slug>.yaml`
- `slides.yaml`

状況確認:

```bash
git status -sb
```

## 8. よくある詰まりどころ

- 元 PDF をリネームしただけだと、git index に古いパスが staged のまま残ることがある
- `uv run` が環境依存で落ちることがある。その場合は PNG/YAML を手で作って先へ進む
- `slides.yaml` の日付、slug、`download` 名がずれると検索や配布名が崩れる
- イベント情報がないと詳細ページの description はサイト既定値にフォールバックする
