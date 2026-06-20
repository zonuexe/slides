---
name: paragraph-merge
description: tadsan の slides リポジトリ (VitePress) で、PDF抽出後の `pdf/<slug>.yaml` に残る para の「泣き別れ」(行折り返しでブロックを跨いで分断された1文) を、AIエージェント自身の判断で結合する手順。`pdf_text_extractor.py` のブロック内結合では繋がらないブロック跨ぎ・単語分断が対象。コードからLLM APIは呼ばず、エージェント(あるいはそのサブエージェント)が結合可否を判断し、決定的な `script/merge_paragraphs.py` が不変条件付きで安全に適用する。「para の泣き別れを直す」「段落の分断を結合」「pdf/*.yaml のテキストを整える」「merge_paragraphs を回す」のような依頼で参照する。
---

# Paragraph Merge (agent-judged)

PDF抽出パイプラインの最終段。`pdf_text_extractor.py` は同一 fitz ブロック内の折り返しを決定的に結合するが、**ブロックを跨いで分断された1文**(大きな装飾文字や、ブロック境界での単語分断 `プロジェ`+`クト`)は残る。これをエージェントの判断で結合する。

**設計の要**: LLM はコードから呼ばない。判断するのは**この手順を実行しているエージェント自身**(必要なら spawn したサブエージェント)。エージェントは「どの連続インデックスを結合するか」だけを決め、実際の結合と安全検証は決定的な `script/merge_paragraphs.py` が行う。文字の追加・欠落・改変はページ単位の不変条件で機械的に排除される。

## 全体フロー

1. 棚卸し → 2. エージェントが結合判断 (decisions JSON) → 3. apply (不変条件付き) → 4. ビルド検証

## 1. 結合候補を棚卸しする

```bash
UV_CACHE_DIR=.uv-cache uv run --project script python script/merge_paragraphs.py inventory --out /tmp/para_runs.json
# 1デッキだけ: ... inventory pdf/<slug>.yaml --out /tmp/para_runs.json
```

`/tmp/para_runs.json` は `[{"id": "<slug>|p<N>|<start>", "frags": ["断片1","断片2",...]}, ...]` の配列。各 `frags` は1ページ内の連続 para 断片(読み順)。`id` は決定的で apply 側と対応する。

現状の残数だけ見るなら `... merge_paragraphs.py status`。

## 2. エージェントが結合可否を判断する

`/tmp/para_runs.json` を読み、各 run について「元は1つの文/段落だが行折り返しで分断されたもの」を**連続インデックスのグループ**にまとめる。

**結合する (MERGE)**
- 折り返しで切れた文: `["静的解析","ツールの種類"]` → `[[0,1]]`
- 単語途中の分断: `["…できるプロジェ","クトを用意してます"]` → `[[0,1]]`
- 1文が複数行に渡るもの全体: `["説明の抽象度が","高すぎて現実との","ギャップ大きすぎ"]` → `[[0,1,2]]`

**結合しない (separate のまま)**
- それぞれ独立した完結した要点/箇条書きの並び(各行が別の主張)
- タイトルのメタ情報(会社名・氏名・日付・ハッシュタグ・会場)
- **コード断片** (`<?php`, `{` `}`, `=>`, `function`, `$変数`, ファイルパス, アノテーション等) は絶対に結合しない
- ラベル+URL対、図/UIラベルの羅列、別個の固有名詞の列挙(例 `PHPcon新潟`/`PHPcon広島`)

迷ったら**結合しない**(過剰結合より分割のまま残す方が安全)。

判断結果を decisions JSON として書き出す。形式は **id → グループ配列**:

```json
{
  "<slug>|p9|3": [[0,1,2]],
  "<slug>|p15|0": [[0,1]]
}
```

- 各グループは2個以上の連続0始まりインデックス、昇順・非重複。
- 結合グループが無い run はキーごと省略してよい(apply 側は欠損を「結合なし」として扱う)。

### 件数が多いときはサブエージェントに分担

run が数百〜数千になる場合、`/tmp/para_runs.json` をスライスして複数のサブエージェント(Task tool, 例: Sonnet)に配り、各自が担当スライス分の decisions JSON をファイルに書く。**1バッチ ~200 run 程度**に抑えると判断が安定する。最後に全 decisions を1つの JSON にマージする。サブエージェントには上の MERGE / separate ルールをそのまま渡すこと。

## 3. 決定的に適用する

```bash
UV_CACHE_DIR=.uv-cache uv run --project script python script/merge_paragraphs.py apply --decisions /tmp/para_decisions.json
# 反映せず件数だけ見る: ... apply --decisions /tmp/para_decisions.json --dry-run
```

apply は各 yaml の run を**現在のファイルから再計算**して id で対応付け、`_join_wrapped`(抽出器と共通)で結合する。安全網:

- **segment mismatch**: 棚卸し以降に yaml が変わって断片が一致しない run はスキップ(stderr に表示)。
- **ページ不変条件**: そのページの「空白除去テキスト」が変化したら、そのデッキは**書き込まない**(`INVARIANT VIOLATED` を表示)。エージェントが断片を書き換えたり並べ替えたりしても、ここで弾かれる。

つまり apply が成功した範囲では、**結合前後で文字内容はバイト等価**(空白と段落境界だけが動く)。

## 4. 検証

```bash
npm run build
UV_CACHE_DIR=.uv-cache uv run --project script python script/merge_paragraphs.py status   # 残りの multi-para run 数
```

ビルドが通り、status の残数が想定どおり減っていれば完了。残るのは「結合すべきでない正しい別行」が中心。

## 注意

- **冪等**: 結合済み run は次回 inventory に出ない(para が1つにまとまるため)。再実行で取りこぼし(前回サブエージェントが打ち切った分など)を拾える。
- **コミットは依頼があるまでしない**。変更は `pdf/<slug>.yaml` の `text` セクションのみ。`links`/`size` は保持される。
- インライン bold 等の細かな装飾は新スキーマでは持たない(段落構造のみ)。この手順は段落の結合だけを扱う。
