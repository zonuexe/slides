import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { loadSlides, getSlideBySlug } from "./lib/slides.js";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { readFile } from "fs/promises";
import yaml from "js-yaml";

const app = new Hono();

// サイト設定を読み込む
let siteConfig = null;
async function loadSiteConfig() {
  if (!siteConfig) {
    try {
      const configFile = await readFile('./_site.yaml', 'utf8');
      siteConfig = yaml.load(configFile);
    } catch (error) {
      console.error('サイト設定の読み込みに失敗しました:', error);
      // デフォルト設定
      siteConfig = {
        site: { name: "tadsan's slide deck", url: "https://zonuexe.github.io" },
        author: { name: "tadsan", url: "https://twitter.com/tadsan" },
        oembed: { provider_name: "tadsan's slide deck", provider_url: "https://zonuexe.github.io/slides/" },
        embed: { base_url: "https://zonuexe.github.io/slide-pdf.js", slide_path: "https://zonuexe.github.io/slides/pdf" }
      };
    }
  }
  return siteConfig;
}

// スライド一覧ページ
app.get("/slides/", async (c) => {
  try {
    const slides = await loadSlides();

    const html = `
      <!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>スライド一覧</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; }
            .container { max-width: 1200px; margin: 0 auto; }
            .slide-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
            .slide-card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
            .slide-card h3 { margin-top: 0; }
            .slide-link { color: #007bff; text-decoration: none; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>スライド一覧</h1>
            <div class="slide-grid">
              ${slides.map(slide => `
                <div class="slide-card">
                  <h3 ><a class="slide-link" href="/slides/${slide.slug}/">${slide.title}</a></h3>
                  <p style="font-size: small; color: gray">${slide.slug}</p>
                  <p>公開日: <time datetime="${slide.date}">${slide.date}</time></p>
                </div>
              `).join('\n')}
            </div>
          </div>
        </body>
      </html>
    `;

    return c.html(html.trim());
  } catch (error) {
    console.error('Error loading slides:', error);
    return c.text('スライドの読み込みに失敗しました', 500);
  }
});

// 個別スライドページ（末尾スラッシュ付き）
app.get("/slides/:slug/", async (c) => {
  try {
    const slug = c.req.param("slug");
    const slide = await getSlideBySlug(slug);

    if (!slide) {
      return c.text("スライドが見つかりません", 404);
    }

    // 統一されたPDF URL（#を含むパスを正しくエンコード）
    const slidePath = `/slides/${slide.file}`;
    const pdfUrl = `/slide-pdf.js/?slide=${encodeURIComponent(slidePath)}`;

    // 日付を日本語形式に変換
    const date = new Date(slide.date);
    const japaneseDate = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

    // スライドの最大サイズを取得（デフォルト値も設定）
    let maxWidth = slide.max_width || 1024;
    let maxHeight = slide.max_height || 768;

    // 縦幅が既定値より小さい場合は自動的にリサイズ
    const defaultMinHeight = 1024;
    if (maxHeight < defaultMinHeight) {
      // アスペクト比を保持してmaxHeightを1024に拡大
      const aspectRatio = maxWidth / maxHeight;
      maxHeight = defaultMinHeight;
      maxWidth = Math.round(maxHeight * aspectRatio);
    }

    const config = await loadSiteConfig();
    const html = `
      <!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">

          <meta property="og:title" content="${slide.title}">
          <meta property="og:description" content="${config.site.description}">
          <meta property="og:type" content="website">
          <meta property="og:url" content="${config.site.url}/slides/${slide.slug}/">
          <meta property="og:site_name" content="${config.ogp.site_name}">
          <meta property="og:locale" content="${config.ogp.locale}">

          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:site" content="${config.twitter.site}">
          <meta name="twitter:creator" content="${config.twitter.creator}">
          <meta name="twitter:title" content="${slide.title}">
          <meta name="twitter:description" content="${config.site.description}">

          <link rel="alternate" type="application/json+oembed" href="https://zonuexe.github.io/slides/${slide.slug}/oembed.json">
          <link rel="alternate" type="text/xml+oembed" href="https://zonuexe.github.io/slides/${slide.slug}/oembed.xml">

          <title>${slide.title}</title>
          <script src="https://kit.fontawesome.com/ca9a253b70.js" crossorigin="anonymous"></script>
          <link rel="stylesheet" href="/slides/css/slide.css">
          <style>
            :root {
              --max-width: ${maxWidth}px;
              --aspect-ratio: ${maxWidth} / ${maxHeight};
              --max-height: 66.67vh;
            }
          </style>
          <script>
            // スライド設定をグローバル変数として定義
            window.slideConfig = {
              maxWidth: ${maxWidth},
              maxHeight: ${maxHeight},
              download: '${slide.download}'
            };
          </script>
          <script src="/slides/js/slide-functions.js"></script>
          <script>
            // スライドの初期化
            initializeSlide();
          </script>
        </head>
        <body>
          <div class="container">
            <iframe src="${pdfUrl}" id="pdf-container" title="${slide.title}"></iframe>
            <div class="pdf-controls">
              <button class="fullscreen-btn" onclick="toggleExpanded()">
                <i class="fa-solid fa-expand"></i>
              </button>
            </div>

            <!-- Toast通知用の要素 -->
            <div id="toast" class="toast"></div>

            <div class="slide-info">
              <button class="share-btn" onclick="shareSlide()">
                <i class="fa-solid fa-share-nodes"></i>
              </button>
              <button class="fullscreen-info-btn" onclick="toggleFullscreen()">
                <i class="fa-solid fa-display"></i>
              </button>
              <h1>${slide.title}</h1>
              <p>公開日: <time datetime="${slide.date}">${japaneseDate}</time></p>

              ${slide.hashtags && slide.hashtags.length > 0 ? `
                <div class="hashtags">
                  ${slide.hashtags.map(tag => `<a href="https://twitter.com/hashtag/${tag}" target="_blank" rel="noopener noreferrer" class="hashtag">#${tag}</a>`).join('')}
                </div>
              ` : ''}

              <div style="margin-top: 20px;">
                <a href="${slidePath}" download="${slide.download}" class="download-btn">
                  <i class="fa-solid fa-download"></i> Download PDF
                </a>
                <button class="download-image-btn" onclick="downloadCanvasAsImage()">
                  <i class="fa-solid fa-image"></i> Save Current Page
                </button>
                <button class="copy-image-btn" onclick="copyCanvasToClipboard()">
                  <i class="fa-solid fa-copy"></i> Copy Current Page
                </button>
              </div>
            </div>
            <div class="back-link">
              <a href="/slides/" class="back-btn">
                <i class="fa-solid fa-arrow-left"></i>
                スライド一覧に戻る
              </a>
            </div>
          </div>
        </body>
      </html>
    `;

    return c.html(html.trim());
  } catch (error) {
    console.error('Error loading slide:', error);
    return c.text('スライドの読み込みに失敗しました', 500);
  }
});

// oEmbed JSONエンドポイント
app.get("/slides/:slug/oembed.json", async (c) => {
  try {
    const slug = c.req.param("slug");
    const slide = await getSlideBySlug(slug);

    if (!slide) {
      return c.text("スライドが見つかりません", 404);
    }

    const config = await loadSiteConfig();
    const currentUrl = `${config.site.url}/slides/${slug}/`;
    const embedUrl = `${config.embed.base_url}/?slide=${encodeURIComponent(`${config.embed.slide_path}/${slide.file}`)}`;

    const oembedData = {
      type: config.oembed.type,
      version: config.oembed.version,
      title: slide.title,
      url: embedUrl,
      author_name: config.author.name,
      author_url: config.author.url,
      provider_name: config.oembed.provider_name,
      provider_url: config.oembed.provider_url,
      width: slide.max_width || 1024,
      height: slide.max_height || 768,
      html: `<iframe src="${embedUrl}" width="${slide.max_width || 1024}" height="${slide.max_height || 768}" frameborder="0" scrolling="no" title="${slide.title}"></iframe>`
    };

    return c.json(oembedData);
  } catch (error) {
    console.error('Error loading oEmbed JSON:', error);
    return c.text('oEmbed JSONの読み込みに失敗しました', 500);
  }
});

// oEmbed XMLエンドポイント
app.get("/slides/:slug/oembed.xml", async (c) => {
  try {
    const slug = c.req.param("slug");
    const slide = await getSlideBySlug(slug);

    if (!slide) {
      return c.text("スライドが見つかりません", 404);
    }

    const config = await loadSiteConfig();
    const currentUrl = `${config.site.url}/slides/${slug}/`;
    const embedUrl = `${config.embed.base_url}/?slide=${encodeURIComponent(`${config.embed.slide_path}/${slide.file}`)}`;

    const oembedData = {
      type: config.oembed.type,
      version: config.oembed.version,
      title: slide.title,
      url: embedUrl,
      author_name: config.author.name,
      author_url: config.author.url,
      provider_name: config.oembed.provider_name,
      provider_url: config.oembed.provider_url,
      width: slide.max_width || 1024,
      height: slide.max_height || 768,
      html: `<iframe src="${embedUrl}" width="${slide.max_width || 1024}" height="${slide.max_height || 768}" frameborder="0" scrolling="no" title="${slide.title}"></iframe>`
    };

    // XML形式で出力
    const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<oembed>
  <type>${oembedData.type}</type>
  <version>${oembedData.version}</version>
  <title>${oembedData.title}</title>
  <url>${oembedData.url}</url>
  <author_name>${oembedData.author_name}</author_name>
  <author_url>${oembedData.author_url}</author_url>
  <provider_name>${oembedData.provider_name}</provider_name>
  <provider_url>${oembedData.provider_url}</provider_url>
  <width>${oembedData.width}</width>
  <height>${oembedData.height}</height>
  <html><![CDATA[${oembedData.html}]]></html>
</oembed>`;

    return new Response(xml, {
      headers: { "Content-Type": "application/xml; charset=utf-8" }
    });
  } catch (error) {
    console.error('Error loading oEmbed XML:', error);
    return c.text('oEmbed XMLの読み込みに失敗しました', 500);
  }
});

// CSSファイルの配信
app.get("/slides/css/*", async (c) => {
  const path = c.req.path.replace("/slides/css/", "");
  try {
    const filePath = `./css/${decodeURIComponent(path)}`;
    const stats = await stat(filePath);

    if (stats.isFile()) {
      const contentType = path.endsWith(".css") ? "text/css" : "application/octet-stream";
      const stream = createReadStream(filePath);
      return new Response(stream, {
        headers: { "Content-Type": contentType },
      });
    } else {
      return c.text("ファイルが見つかりません", 404);
    }
  } catch (error) {
    return c.text("ファイルが見つかりません", 404);
  }
});

// JavaScriptファイルの配信
app.get("/slides/js/*", async (c) => {
  const path = c.req.path.replace("/slides/js/", "");
  try {
    const filePath = `./js/${decodeURIComponent(path)}`;
    const stats = await stat(filePath);

    if (stats.isFile()) {
      const contentType = path.endsWith(".js") ? "application/javascript" : "application/octet-stream";
      const stream = createReadStream(filePath);
      return new Response(stream, {
        headers: { "Content-Type": contentType },
      });
    } else {
      return c.text("ファイルが見つかりません", 404);
    }
  } catch (error) {
    return c.text("ファイルが見つかりません", 404);
  }
});

// 静的ファイルの配信
app.get("/slides/pdf/*", async (c) => {
  const path = c.req.path.replace("/slides/pdf/", "");
  try {
    const filePath = `./pdf/${decodeURIComponent(path)}`;
    const stats = await stat(filePath);

    if (stats.isFile()) {
      const contentType = path.endsWith(".pdf") ? "application/pdf" : "application/octet-stream";
      const stream = createReadStream(filePath);
      return new Response(stream, {
        headers: { "Content-Type": contentType },
      });
    } else {
      return c.text("ファイルが見つかりません", 404);
    }
  } catch (error) {
    return c.text("ファイルが見つかりません", 404);
  }
});

// slide-pdf.js の静的ファイル配信
app.get("/slide-pdf.js/*", async (c) => {
  const path = c.req.path.replace("/slide-pdf.js/", "");
  try {
    // ../slide-pdf.js/ 以下のファイルを配信
    const filePath = `../slide-pdf.js/${decodeURIComponent(path)}`;
    console.log(`Requested path: ${c.req.path}, File path: ${filePath}`);

    const stats = await stat(filePath);

    if (stats.isFile()) {
      // ファイル拡張子に基づいてContent-Typeを設定
      let contentType = "application/octet-stream";
      if (path.endsWith(".js")) contentType = "application/javascript";
      else if (path.endsWith(".css")) contentType = "text/css";
      else if (path.endsWith(".html")) contentType = "text/html";
      else if (path.endsWith(".json")) contentType = "application/json";
      else if (path.endsWith(".png")) contentType = "image/png";
      else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) contentType = "image/jpeg";
      else if (path.endsWith(".svg")) contentType = "image/svg+xml";

      const stream = createReadStream(filePath);
      return new Response(stream, {
        headers: { "Content-Type": contentType },
      });
    } else if (stats.isDirectory()) {
      // ディレクトリの場合は index.html を探す
      const indexPath = `${filePath}/index.html`;
      try {
        const indexStats = await stat(indexPath);
        if (indexStats.isFile()) {
          const stream = createReadStream(indexPath);
          return new Response(stream, {
            headers: { "Content-Type": "text/html" },
          });
        }
      } catch (indexError) {
        console.log(`index.html not found in directory: ${filePath}`);
      }
      // index.html が存在しない場合は404エラー
      console.log(`Directory access without index.html: ${filePath}`);
      return c.text("ファイルが見つかりません", 404);
    } else {
      console.log(`File not found: ${filePath}`);
      return c.text("ファイルが見つかりません", 404);
    }
  } catch (error) {
    console.error(`Error serving file: ${error.message}`);
    return c.text("ファイルが見つかりません", 404);
  }
});

console.log("🚀 Hono server is running on http://localhost:3000");

// Node.js用のサーバー起動
serve({
  fetch: app.fetch,
  port: 3000
});
