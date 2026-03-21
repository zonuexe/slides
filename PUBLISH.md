# npmパッケージ配布ガイド

## 概要

このプロジェクトのVitePressモジュールをnpmパッケージとして配布するためのガイドです。

## パッケージ構造

```
packages/vitepress-slides/
├── src/
│   ├── index.js              # メインエントリーポイント
│   ├── plugins/
│   │   ├── index.js
│   │   ├── slides-data.js
│   │   ├── pdf-assets.js
│   │   └── oembed.js
│   ├── components/
│   │   ├── index.js
│   │   ├── SlidesCatalog.vue
│   │   ├── SlideDetailPage.vue
│   │   ├── SlideCard.vue
│   │   ├── SlideTextNode.vue
│   │   └── SlideTextNodes.vue
│   └── styles/
│       └── index.css
├── package.json
├── vite.config.js
├── README.md
├── .npmignore
└── .gitignore
```

## セットアップ手順

### 1. 既存ファイルをコピー

```bash
# プラグインをコピー（設定可能版を使用）
cp packages/vitepress-slides/src/plugins/*.js packages/vitepress-slides/src/plugins/

# コンポーネントをコピー
cp docs/.vitepress/theme/components/*.vue packages/vitepress-slides/src/components/

# スタイルをコピー
mkdir -p packages/vitepress-slides/src/styles
cp docs/.vitepress/theme/styles/tailwind.css packages/vitepress-slides/src/styles/index.css
```

### 2. 依存関係のインストール

```bash
cd packages/vitepress-slides
pnpm install
```

### 3. ビルド

```bash
pnpm build
```

### 4. 動作確認

```bash
# ローカルでテスト
pnpm link
# 別のプロジェクトで
pnpm link @zonuexe/vitepress-slides
```

## 使用例

### プラグインの使用

```javascript
// docs/.vitepress/config.js
import { defineConfig } from "vitepress";
import { slidesDataPlugin, pdfAssetsPlugin, oembedPlugin } from "@zonuexe/vitepress-slides/plugins";
import { generateSlidesData } from "./lib/slides-data.js";
import { loadSiteConfig } from "./lib/site-config.js";

export default defineConfig({
  vite: {
    plugins: [
      slidesDataPlugin({
        generateSlidesData,
        loadSiteConfig,
      }),
      pdfAssetsPlugin(),
      oembedPlugin({
        generateSlidesData,
        loadSiteConfig,
      }),
    ],
  },
});
```

### コンポーネントの使用

```javascript
// docs/.vitepress/theme/index.js
import DefaultTheme from "vitepress/theme";
import {
  SlidesCatalog,
  SlideDetailPage,
} from "@zonuexe/vitepress-slides/components";
import "@zonuexe/vitepress-slides/styles";

export default {
  ...DefaultTheme,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx);
    ctx.app.component("SlidesCatalog", SlidesCatalog);
    ctx.app.component("SlideDetailPage", SlideDetailPage);
  },
};
```

## 公開手順

### 1. npmアカウントの準備

```bash
# npmにログイン
npm login

# 組織スコープの場合は、組織にメンバーとして追加されている必要があります
```

### 2. バージョン管理

```bash
# バージョンを更新
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0
```

### 3. 公開

```bash
cd packages/vitepress-slides
npm publish --access public
```

## 注意事項

1. **`lib/`ディレクトリの依存**: プラグインは`generateSlidesData`と`loadSiteConfig`関数を外部から受け取る必要があります。これらは別パッケージにするか、各プロジェクトで実装する必要があります。

2. **設定の柔軟性**: ハードコードされたパスを設定可能にする必要があります。

3. **型定義**: TypeScriptの型定義ファイル（`.d.ts`）を生成することを推奨します。

4. **バージョン管理**: セマンティックバージョニングに従ってください。

5. **README**: 使用方法を明確にドキュメント化してください。

## モノレポ構成の場合

pnpm workspaceを使用する場合：

```json
// ルートのpackage.json
{
  "private": true,
  "workspaces": [
    "packages/*"
  ]
}
```

## トラブルシューティング

### 公開エラー

- パッケージ名が既に存在する場合は変更が必要です
- 組織スコープを使用する場合は、適切な権限が必要です

### ビルドエラー

- 依存関係が正しくインストールされているか確認
- `peerDependencies`が正しく設定されているか確認
