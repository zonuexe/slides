import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { loadSlides, getSlideBySlug } from "./lib/slides.js";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { readFile } from "fs/promises";
import yaml from "js-yaml";

// HTMLエスケープ関数（サーバーサイド用）
function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderNode(node) {
  if (!node || !node.node) return '';

  switch (node.node) {
    case 'p':
      return `<p>${node.children ? node.children.map(child => renderNode(child)).join('') : ''}</p>`;

    case 'text':
      return escapeHtml(node.content || '');

    case 'bold':
      return `<strong>${escapeHtml(node.content || '')}</strong>`;

    case 'link':
      const faviconUrl = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(node.href || '')}&size=32`;
      const faviconImg = `<img width="16" src="${faviconUrl}" alt="">`;
      return `${faviconImg}<a href="${escapeHtml(node.href || '')}" target="_blank">${escapeHtml(node.content || '')}</a>`;

    case 'img':
      return '[img]';

    case 'br':
      return '<br>';

    case 'ul':
      return `<ul>${node.children ? node.children.map(child => renderNode(child)).join('') : ''}</ul>`;

    case 'li':
      if (node.children) {
        return `<li>${node.children.map(child => renderNode(child)).join('')}</li>`;
      } else {
        return `<li>${escapeHtml(node.content || '')}</li>`;
      }

    default:
      return escapeHtml(node.content || '');
  }
}

const app = new Hono();

// サイト設定を読み込む（キャッシュなし）
const SNIPPET_LENGTH = 160;

function collectTextFromNode(node, collector) {
  if (!node || typeof node !== "object") return;
  if (typeof node.content === "string") {
    collector.push(node.content);
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => collectTextFromNode(child, collector));
  }
}

function extractTextContent(meta) {
  if (!meta || typeof meta !== "object") return "";
  const collected = [];
  const textSections = meta.text;
  if (textSections && typeof textSections === "object") {
    const values = Array.isArray(textSections)
      ? textSections
      : Object.values(textSections);
    values.forEach((section) => {
      if (Array.isArray(section)) {
        section.forEach((node) => collectTextFromNode(node, collected));
      }
    });
  }
  const links = meta.links;
  if (links && typeof links === "object") {
    Object.values(links).forEach((items) => {
      if (Array.isArray(items)) {
        items.forEach((link) => {
          if (link && typeof link.title === "string") {
            collected.push(link.title);
          }
          if (link && typeof link.url === "string") {
            collected.push(link.url);
          }
        });
      }
    });
  }
  return collected
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSnippet(text) {
  if (!text) return "";
  const normalised = text.replace(/\s+/g, " ").trim();
  if (normalised.length <= SNIPPET_LENGTH) {
    return normalised;
  }
  return `${normalised.slice(0, SNIPPET_LENGTH)}…`;
}

async function loadSiteConfig() {
  try {
    const configFile = await readFile('./_site.yaml', 'utf8');
    return yaml.load(configFile);
  } catch (error) {
    console.error('サイト設定の読み込みに失敗しました:', error);
    // デフォルト設定
    return {
      site: { name: "tadsan's slide deck", url: "https://zonuexe.github.io" },
      author: { name: "tadsan", url: "https://twitter.com/tadsan" },
      oembed: { provider_name: "tadsan's slide deck", provider_url: "https://zonuexe.github.io/slides/" },
      embed: { base_url: "https://zonuexe.github.io/slide-pdf.js", slide_path: "https://zonuexe.github.io/slides/pdf" }
    };
  }
}

// スライドのファイル名からPDFメタデータを取得（キャッシュなし）
async function getPdfMetaByFile(filePath, slide) {
  // slide.metaが指定されている場合はそのファイルを読み込む
  if (slide.meta) {
    try {
      const metaFile = await readFile(slide.meta, 'utf8');
      const metaData = yaml.load(metaFile);
      return metaData;
    } catch (error) {
      console.error(`メタデータファイルの読み込みに失敗しました (${slide.meta}):`, error);
    }
  }

  // デフォルト値を返す
  return {
    size: {
      max_width: slide.max_width || 1024,
      max_height: slide.max_height || 768
    },
    links: {}
  };
}

async function generateSlidesData() {
  const slides = await loadSlides();
  const enrichedSlides = [];

  for (const slide of slides) {
    let searchContent = "";
    try {
      const meta = await getPdfMetaByFile(slide.file, slide);
      searchContent = extractTextContent(meta);
    } catch (error) {
      console.warn(`メタデータ読み込み時の警告 (${slide.slug}):`, error);
    }
    enrichedSlides.push({
      ...slide,
      searchContent,
      snippet: buildSnippet(searchContent || slide.title || ""),
    });
  }

  const slidesForClient = enrichedSlides.map((slide) => ({
    slug: slide.slug ?? "",
    title: slide.title ?? "",
    date: slide.date ?? "",
    content: slide.searchContent ?? "",
  }));
  const slidesJson = JSON.stringify(slidesForClient).replace(/</g, "\\u003c");

  return { enrichedSlides, slidesJson };
}

// スライド一覧ページ
app.get("/slides/", async (c) => {
  try {
    const { enrichedSlides, slidesJson } = await generateSlidesData();

    const html = `
      <!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>tadsan's slide deck</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f7f7f7; }
            .container { max-width: 1200px; margin: 0 auto; }
            .search-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 20px 0; }
            .search-label { flex: 1 1 280px; max-width: 600px; }
            .search-input { flex: 1 1 280px; width: 100%; padding: 10px 14px; border: 1px solid #ccc; border-radius: 999px; font-size: 1rem; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
            .search-input:focus { outline: none; border-color: #007bff; box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.15); }
            .search-result { font-size: 0.9rem; color: #555; margin: 0; }
            .slide-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
            .slide-card { border: 1px solid #ddd; padding: 20px; border-radius: 8px; background-color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
            .slide-card h3 { margin-top: 0; }
            .slide-card-meta { font-size: 0.9rem; color: gray; margin: 0 0 8px 0; }
            .slide-card-snippet { margin-top: 12px; font-size: 0.95rem; color: #444; line-height: 1.5; }
            .slide-card-snippet mark { background-color: rgba(255, 230, 0, 0.6); padding: 0 2px; border-radius: 2px; }
            .slide-link { color: #007bff; text-decoration: none; }
            .slide-link:hover { text-decoration: underline; }
            .no-results { grid-column: 1 / -1; text-align: center; padding: 40px 0; color: #666; font-size: 1rem; }
            .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
          </style>
          <link rel="preload" href="https://cdn.jsdelivr.net/npm/fuse.js@7.1.0/dist/fuse.min.js" as="script" crossorigin="anonymous">
          <link rel="preload" href="/slides/index.js" as="script">
          <link rel="preload" href="/slides/js/search.js" as="script">
        </head>
        <body>
          <div class="container">
            <h1><a href="http://twitter.com/tadsan">tadsan</a>'s slide deck <wbr> ヾ(〃＞＜)ﾉﾞ</h1>
            <div class="search-toolbar">
              <label class="search-label">
                <span class="visually-hidden">スライドを検索</span>
                <input id="search-input" class="search-input" type="search" placeholder="タイトル・スラッグ・日付・本文で検索" autocomplete="off">
              </label>
              <p id="search-result-count" class="search-result">全 ${enrichedSlides.length}件</p>
            </div>
            <div class="slide-grid">
              ${enrichedSlides.map(slide => `
                <div class="slide-card">
                  <h3 ><a class="slide-link" href="/slides/${escapeHtml(slide.slug ?? "")}/">${escapeHtml(slide.title ?? "")}</a></h3>
                  <p class="slide-card-meta">${escapeHtml(slide.slug ?? "")}</p>
                  <p>公開日: <time datetime="${escapeHtml(slide.date ?? "")}">${escapeHtml(slide.date ?? "")}</time></p>
                </div>
              `).join('\n')}
          </div>
        </div>
        <hr>
        <address>&copy; 2025 USAMI Kenta (@tadsan)</address>
        <script src="https://cdn.jsdelivr.net/npm/fuse.js@7.1.0/dist/fuse.min.js" defer></script>
        <script src="/slides/index.js" defer></script>
        <script src="/slides/js/search.js" defer></script>
      </body>
    </html>
  `;

    return c.html(html.trim());
  } catch (error) {
    console.error('Error loading slides:', error);
    return c.text('スライドの読み込みに失敗しました', 500);
  }
});

// スライドデータ配信用
app.get("/slides/index.js", async (c) => {
  try {
    const { slidesJson } = await generateSlidesData();
    const body = `window.slidesData = ${slidesJson};`;
    return new Response(body, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error generating slides data script:", error);
    return new Response("console.error('Failed to load slides data');", {
      status: 500,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
      },
    });
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

    // PDFメタデータからサイズ情報を取得
    const pdfMeta = await getPdfMetaByFile(slide.file, slide);
    let maxWidth = pdfMeta.size?.max_width || slide.max_width || 1024;
    let maxHeight = pdfMeta.size?.max_height || slide.max_height || 768;

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
          <meta property="og:image" content="${config.site.url}/slides/${slide.image}">
          <meta property="og:site_name" content="${config.ogp.site_name}">
          <meta property="og:locale" content="${config.ogp.locale}">

          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:site" content="${config.twitter.site}">
          <meta name="twitter:creator" content="${config.twitter.creator}">
          <meta name="twitter:title" content="${slide.title}">
          <meta name="twitter:description" content="${config.site.description}">
          <meta name="twitter:image" content="${config.site.url}/slides/${slide.image}">

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

              ${slide.events && slide.events.length > 0 ? `
                <div class="event-info">
                  ${slide.events.map(event => {
      const eventDate = new Date(event.presented_at);
      const eventJapaneseDate = `${eventDate.getFullYear()}年${eventDate.getMonth() + 1}月${eventDate.getDate()}日`;
      return `<p><time datetime="${event.presented_at}">${eventJapaneseDate}</time>に${event.location}の${event.place}で開催された『<a href="${event.url}" target="_blank">${event.name}</a>』で${event.type}(${event.talk_duration}分)として発表しました。</p>`;
    }).join('')}
                </div>
              ` : ''}

              ${slide.related_articles && slide.related_articles.length > 0 ? `
                <div class="related-articles">
                  <ul>
                    ${slide.related_articles.map(article => {
      const faviconUrl = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(article.url)}&size=32`;
      const faviconImg = `<img width="16" src="${faviconUrl}" alt="">`;
      const descHtml = article.desc ? `<br>${escapeHtml(article.desc)}` : '';
      return `<li>${faviconImg}<a href="${escapeHtml(article.url)}" target="_blank">${escapeHtml(article.title)}</a>${descHtml}</li>`;
    }).join('')}
                  </ul>
                </div>
              ` : ''}

              ${slide.hashtags && slide.hashtags.length > 0 ? `
                <div class="hashtags">
                  ${slide.hashtags.map(tag => `<a href="https://twitter.com/hashtag/${tag}" target="_blank" class="hashtag">#${tag}</a>`).join('')}
                </div>
              ` : ''}

              <div class="download-section">
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

            <div class="slide-content">
              <div class="content-panes">
                <div class="text-pane">
                  <h3>スライドテキスト</h3>
                  ${pdfMeta.text && Object.keys(pdfMeta.text).length > 0 ? `
                    ${Object.entries(pdfMeta.text).map(([pageKey, nodes]) => `
                      <div class="page-content" id="page-${pageKey.replace('p', '')}">
                        <h4>Page ${pageKey.replace('p', '')}</h4>
                        <div class="page-text">
                          ${nodes.map(node => renderNode(node)).join('')}
                        </div>
                      </div>
                    `).join('')}
                  ` : `
                    <p>テキスト情報がありません。</p>
                  `}
                </div>

                <div class="links-pane">
                  <h3>関連リンク</h3>
                  ${pdfMeta.links && Object.keys(pdfMeta.links).length > 0 ? `
                    ${Object.entries(pdfMeta.links).map(([pageKey, links]) => `
                      <div class="page-content" id="page-${pageKey.replace('p', '')}">
                        <h4>Page ${pageKey.replace('p', '')}</h4>
                        <div class="page-links">
                          <ul>
                            ${links.map(link => {
      const href = link.archive || link.url;
      const faviconUrl = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(href)}&size=32`;
      const faviconImg = `<img width="16" src="${faviconUrl}" alt="">`;

      if (link.archive) {
        return `<li>${faviconImg}<a href="${escapeHtml(href)}" target="_blank">${escapeHtml(link.title)}</a><br>(original: ${escapeHtml(link.url)})</li>`;
      } else {
        return `<li>${faviconImg}<a href="${escapeHtml(href)}" target="_blank">${escapeHtml(link.title)}</a></li>`;
      }
    }).join('')}
                          </ul>
                        </div>
                      </div>
                    `).join('')}
                  ` : `
                    <p>関連リンクがありません。</p>
                  `}
                </div>
              </div>
            </div>
            <div class="back-link">
              <a href="/slides/" class="back-btn">
                <i class="fa-solid fa-arrow-left"></i>
                スライド一覧に戻る
              </a>
            </div>
          </div>
          <hr>
          <address>&copy; 2025 USAMI Kenta (@tadsan)</address>
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
