import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { loadSlides, getSlideBySlug } from "./lib/slides.js";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { readFile } from "fs/promises";
import { extname, resolve } from "node:path";
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

const BASE_DIR = resolve(".");

const MIME_TYPES = new Map([
  [".css", "text/css"],
  [".js", "application/javascript"],
  [".mjs", "application/javascript"],
  [".json", "application/json"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"],
  [".ico", "image/x-icon"],
]);

function detectContentType(filePath, fallback) {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES.get(ext) || fallback || "application/octet-stream";
}

function serveStatic(options = {}) {
  const {
    root = ".",
    rewriteRequestPath,
    fallbackContentType,
    indexFile = null,
    maxAge = 0,
  } = options;

  const resolvedRoot = resolve(BASE_DIR, root);
  const cacheHeader =
    maxAge > 0 ? `public, max-age=${maxAge}` : "public, max-age=0, must-revalidate";

  return async (c) => {
    try {
      let requestPath = c.req.path;
      if (typeof rewriteRequestPath === "function") {
        const rewritten = rewriteRequestPath(requestPath, c);
        if (typeof rewritten === "string" && rewritten) {
          requestPath = rewritten;
        }
      }

      if (!requestPath) {
        return c.text("ファイルが見つかりません", 404);
      }

      const decoded = decodeURIComponent(requestPath);
      let relativePath = decoded.startsWith("/") ? decoded.slice(1) : decoded;
      let targetPath = resolve(resolvedRoot, relativePath);

      if (!targetPath.startsWith(resolvedRoot)) {
        return c.text("ファイルが見つかりません", 404);
      }

      let stats;
      try {
        stats = await stat(targetPath);
      } catch {
        return c.text("ファイルが見つかりません", 404);
      }

      if (stats.isDirectory()) {
        if (!indexFile) {
          return c.text("ファイルが見つかりません", 404);
        }
        targetPath = resolve(targetPath, indexFile);
        if (!targetPath.startsWith(resolvedRoot)) {
          return c.text("ファイルが見つかりません", 404);
        }
        try {
          stats = await stat(targetPath);
        } catch {
          return c.text("ファイルが見つかりません", 404);
        }
        if (!stats.isFile()) {
          return c.text("ファイルが見つかりません", 404);
        }
      } else if (!stats.isFile()) {
        return c.text("ファイルが見つかりません", 404);
      }

      const stream = createReadStream(targetPath);
      const headers = {
        "Content-Type": detectContentType(targetPath, fallbackContentType),
        "Cache-Control": cacheHeader,
      };

      return new Response(stream, { headers });
    } catch {
      return c.text("ファイルが見つかりません", 404);
    }
  };
}

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

function toSearchFragment(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return "";
}

function collectEventsText(events) {
  if (!Array.isArray(events)) return "";
  return events
    .flatMap((event) => {
      if (!event || typeof event !== "object") return [];
      const fragments = [
        event?.name,
        event?.type,
        event?.location,
        event?.place,
        event?.presented_at,
        event?.url,
        event?.talk_duration,
      ].flatMap((value) => {
        const fragment = toSearchFragment(value);
        return fragment ? [fragment] : [];
      });
      const combined = fragments.join(" ").trim();
      return combined ? [combined] : [];
    })
    .join(" ");
}

function collectRelatedArticlesText(relatedArticles) {
  if (!Array.isArray(relatedArticles)) return "";
  return relatedArticles
    .flatMap((article) => {
      if (!article || typeof article !== "object") return [];
      const fragments = [article?.title, article?.desc, article?.url].flatMap((value) => {
        const fragment = toSearchFragment(value);
        return fragment ? [fragment] : [];
      });
      const combined = fragments.join(" ").trim();
      return combined ? [combined] : [];
    })
    .join(" ");
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
    const eventsText = collectEventsText(slide.events);
  const relatedArticlesText = collectRelatedArticlesText(slide.related_articles);
  const tagText = Array.isArray(slide.tags)
      ? slide.tags
          .flatMap((tag) => {
            if (typeof tag !== "string") return [];
            const value = tag.trim();
            return value ? [value] : [];
          })
          .join(" ")
      : "";
  const hashtagText = Array.isArray(slide.hashtags)
      ? slide.hashtags
          .flatMap((tag) => {
            if (typeof tag !== "string") return [];
            const value = tag.trim();
            return value ? [`#${value}`] : [];
          })
          .join(" ")
      : "";
    const combinedContent = [
      searchContent,
      eventsText,
      relatedArticlesText,
      tagText,
      hashtagText,
    ]
      .filter(Boolean)
      .join(" ");

    enrichedSlides.push({
      ...slide,
      searchContent,
      eventsText,
      relatedArticlesText,
      combinedContent,
      snippet: buildSnippet(combinedContent || slide.title || ""),
    });
  }

  const slidesForClient = enrichedSlides.map((slide) => ({
    slug: slide.slug ?? "",
    title: slide.title ?? "",
    date: slide.date ?? "",
    content: slide.combinedContent ?? slide.searchContent ?? "",
    snippet: slide.snippet ?? "",
    events: Array.isArray(slide.events)
      ? slide.events.flatMap((event) => {
          if (!event || typeof event !== "object") return [];
          const name = typeof event.name === "string" ? event.name : "";
          if (!name) return [];
          const presentedAt = typeof event.presented_at === "string" ? event.presented_at : "";
          const location = typeof event.location === "string" ? event.location : "";
          const place = typeof event.place === "string" ? event.place : "";
          return [
            {
              name,
              presented_at: presentedAt,
              location,
              place,
            },
          ];
        })
      : [],
    tags: Array.isArray(slide.tags)
      ? slide.tags.flatMap((tag) => {
          if (typeof tag !== "string") return [];
          const value = tag.trim();
          return value ? [value] : [];
        })
      : [],
  }));
  const slidesJson = JSON.stringify(slidesForClient).replace(/</g, "\\u003c");

  return { enrichedSlides, slidesJson };
}

// スライド一覧ページ
app.get("/slides/", async (c) => {
  try {
    const { enrichedSlides, slidesJson } = await generateSlidesData();
    const config = await loadSiteConfig();

    const html = `
      <!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>tadsan's slide deck</title>
          <link rel="icon" type="image/png" href="/slides/zonuexe.png">
          <link rel="preload" href="/slides/css/index.css" as="style">
          <link rel="stylesheet" href="/slides/css/index.css">
          <link rel="preload" href="https://cdn.jsdelivr.net/npm/fuse.js@7.1.0/dist/fuse.min.js" as="script" crossorigin="anonymous">
          <link rel="preload" href="/slides/index.js" as="script">
          <link rel="preload" href="/slides/js/search.js" as="script">
          <script src="https://kit.fontawesome.com/ca9a253b70.js" crossorigin="anonymous"></script>
        </head>
        <body>
          <main class="container h-feed">
            <h1 class="site-title h-card p-author"><a href="http://twitter.com/tadsan" class="p-name u-url"><img src="/slides/zonuexe.png" alt="" width="32" style="margin: 0 5px"></a>tadsan's slide deck <wbr> ヾ(〃＞＜)ﾉﾞ</h1>
            <div class="search-toolbar">
              <label class="search-label">
                <span class="visually-hidden">スライドを検索</span>
                <input id="search-input" class="search-input" type="search" placeholder="タイトル・スラッグ・日付・本文で検索" autocomplete="off">
              </label>
              <p id="search-result-count" class="search-result">全 ${enrichedSlides.length}件</p>
            </div>
            <div class="slide-grid">
              ${enrichedSlides.map(slide => `
                <div class="slide-card h-entry">
                  <h3><a class="slide-link p-name u-url" href="/slides/${escapeHtml(slide.slug ?? "")}/">${escapeHtml(slide.title ?? "")}</a></h3>
                  <p class="slide-card-meta">${escapeHtml(slide.slug ?? "")}</p>
                  <p>公開日: <time class="dt-published" datetime="${escapeHtml(slide.date ?? "")}">${escapeHtml(slide.date ?? "")}</time></p>
                  ${Array.isArray(slide.events) && slide.events.some(event => event && event.name) ? `
                    <div class="slide-card-events">
                      ${slide.events
          .flatMap((event) => {
            if (!event || !event.name) return [];
            const presentedAt = typeof event.presented_at === "string" ? event.presented_at : "";
            const locationParts = [];
            if (typeof event.location === "string" && event.location) locationParts.push(event.location);
            if (typeof event.place === "string" && event.place) locationParts.push(event.place);
            const locationText = locationParts.join(" / ");
            const locationHtml = locationText
              ? ` <span class="p-location visually-hidden">${escapeHtml(locationText)}</span>`
              : "";
            return [
              `<p class="slide-card-event h-event"><i class="fa-solid fa-microphone-lines" aria-hidden="true"></i> <span class="p-name">${escapeHtml(event.name)}</span>${
                presentedAt
                  ? ` <time class="dt-start visually-hidden" datetime="${escapeHtml(presentedAt)}">${escapeHtml(presentedAt)}</time>`
                  : ""
              }${locationHtml}</p>`,
            ];
          })
          .join("")}
                    </div>
                  ` : ""}
                  ${Array.isArray(slide.tags) && slide.tags.some(tag => typeof tag === "string" && tag.trim()) ? `
                    <ul class="slide-card-tags">
                      ${slide.tags
          .flatMap((tag) => {
            if (typeof tag !== "string" || !tag.trim()) return [];
            return [
              `<li class="p-category"><i class="fa-solid fa-tag" aria-hidden="true"></i> ${escapeHtml(
                tag.trim()
              )}</li>`,
            ];
          })
          .join("")}
                    </ul>
                  ` : ""}
                  ${slide.snippet ? `<p class="slide-card-snippet p-summary visually-hidden">${escapeHtml(slide.snippet)}</p>` : ""}
                  <span class="p-author h-card visually-hidden"><a href="https://twitter.com/tadsan" class="p-name u-url">USAMI Kenta</a></span>
                </div>
              `).join('\n')}
          </main>
        <hr>
        <address class="site-footer h-card">&copy; 2025 <span class="p-name">USAMI Kenta</span> (<a href="https://twitter.com/tadsan" class="u-url">@tadsan</a>)</address>
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

    const eventNarratives = Array.isArray(slide.events)
      ? slide.events.flatMap((event) => {
          const narrative = buildEventNarrative(event);
          return narrative ? [narrative] : [];
        })
      : [];

    const config = await loadSiteConfig();
    const descriptionText =
      eventNarratives.length > 0
        ? eventNarratives.map((entry) => entry.text).join(" ")
        : config.site.description;
    const html = `
      <!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="description" content="${escapeHtml(descriptionText)}">
          <link rel="icon" type="image/png" href="/slides/zonuexe.png">

          <meta property="og:title" content="${slide.title}">
          <meta property="og:description" content="${escapeHtml(descriptionText)}">
          <meta property="og:type" content="website">
          <meta property="og:url" content="${config.site.url}/slides/${slide.slug}/">
          <meta property="og:image" content="${config.site.url}/slides/${slide.image}">
          <meta property="og:site_name" content="${config.ogp.site_name}">
          <meta property="og:locale" content="${config.ogp.locale}">

          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:site" content="${config.twitter.site}">
          <meta name="twitter:creator" content="${config.twitter.creator}">
          <meta name="twitter:title" content="${slide.title}">
          <meta name="twitter:description" content="${escapeHtml(descriptionText)}">
          <meta name="twitter:image" content="${config.site.url}/slides/${slide.image}">

          <link rel="alternate" type="application/json+oembed" href="https://zonuexe.github.io/slides/${slide.slug}/oembed.json">
          <link rel="alternate" type="text/xml+oembed" href="https://zonuexe.github.io/slides/${slide.slug}/oembed.xml">
          <link rel="canonical" href="${config.site.url}/slides/${slide.slug}/">

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
          <main class="container">
            <div id="pdf-container" aria-label="Slide preview">
              <iframe src="${pdfUrl}" title="${slide.title}" scrolling="no"></iframe>
            </div>
            <div class="pdf-controls">
              <button class="fullscreen-btn" onclick="toggleExpanded()">
                <i class="fa-solid fa-expand"></i>
              </button>
            </div>

            <div id="toast" class="toast"></div>

            <article class="slide-info h-entry">
              <button class="share-btn" onclick="shareSlide()">
                <i class="fa-solid fa-share-nodes"></i>
              </button>
              <button class="fullscreen-info-btn" onclick="toggleFullscreen()">
                <i class="fa-solid fa-display"></i>
              </button>
              <h1 class="slide-title"><a href="/slides/${escapeHtml(slide.slug ?? "")}/" class="p-name u-url u-uid permalink-link">${escapeHtml(slide.title ?? "")}</a></h1>
              <p class="published-line">公開日: <time class="dt-published" datetime="${escapeHtml(slide.date ?? "")}">${japaneseDate}</time></p>
              <p class="byline p-author h-card">by <a href="https://twitter.com/tadsan" class="p-name u-url">USAMI Kenta</a> <span class="p-nickname">@tadsan</span></p>

              ${eventNarratives.length > 0 ? `
                <div class="event-info">
                  ${eventNarratives.map(entry => entry.html).join('')}
                </div>
              ` : ''}

              ${slide.related_articles && slide.related_articles.length > 0 ? `
                <div class="related-articles">
                  <ul>
                    ${slide.related_articles.map(article => {
      const faviconUrl = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(article.url)}&size=32`;
      const faviconImg = `<img width="16" src="${faviconUrl}" alt="">`;
      const descHtml = article.desc ? `<br>${escapeHtml(article.desc)}` : '';
      return `<li>${faviconImg}<a href="${escapeHtml(article.url)}" class="u-url" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>${descHtml}</li>`;
    }).join('')}
                  </ul>
                </div>
              ` : ''}

              ${slide.hashtags && slide.hashtags.length > 0 ? `
                <div class="hashtags">
                  ${slide.hashtags.map(tag => `<a href="https://twitter.com/hashtag/${tag}" target="_blank" class="hashtag p-category u-url" rel="noopener">#${tag}</a>`).join('')}
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
              <div class="slide-content e-content">
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
        return `<li>${faviconImg}<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(link.title)}</a><br>(original: <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.url)}</a>)</li>`;
      } else {
        return `<li>${faviconImg}<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(link.title)}</a></li>`;
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
            </article>
          </main>
          <hr>
          <address class="site-footer h-card">&copy; 2025 <span class="p-name">USAMI Kenta</span> (<a href="https://twitter.com/tadsan" class="u-url">@tadsan</a>)</address>
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

// 静的ファイルの配信
app.get(
  "/slides/zonuexe.png",
  serveStatic({
    rewriteRequestPath: () => "/zonuexe.png",
    maxAge: 3600,
  })
);

app.get(
  "/slides/css/*",
  serveStatic({
    root: "./css",
    rewriteRequestPath: (path) => path.replace(/^\/slides\/css/, ""),
  })
);

app.get(
  "/slides/js/*",
  serveStatic({
    root: "./js",
    rewriteRequestPath: (path) => path.replace(/^\/slides\/js/, ""),
  })
);

app.get(
  "/slides/pdf/*",
  serveStatic({
    root: "./pdf",
    rewriteRequestPath: (path) => path.replace(/^\/slides\/pdf/, ""),
  })
);

app.get(
  "/slide-pdf.js/*",
  serveStatic({
    root: "../slide-pdf.js",
    rewriteRequestPath: (path) => path.replace(/^\/slide-pdf\.js/, ""),
    indexFile: "index.html",
  })
);

console.log("🚀 Hono server is running on http://localhost:3000");

// Node.js用のサーバー起動
serve({
  fetch: app.fetch,
  port: 3000
});
function buildEventRoleSegment(event) {
  const type = typeof event.type === "string" ? event.type.trim() : "";
  const hasDuration =
    typeof event.talk_duration === "number" && Number.isFinite(event.talk_duration);
  const durationMinutes = hasDuration ? `${event.talk_duration}分` : "";
  const durationSlot = hasDuration ? `${event.talk_duration}分枠` : "";

  let text = "";
  if (type && hasDuration) {
    text = `${type}(${durationMinutes})として`;
  } else if (hasDuration) {
    text = `${durationSlot}として`;
  } else if (type) {
    text = `${type}として`;
  }

  let html = "";
  if (type && hasDuration) {
    const typeHtml = `<span class="p-category">${escapeHtml(type)}</span>`;
    const durationHtml = `<span class="p-duration" data-duration="${escapeHtml(
      String(event.talk_duration)
    )}">${escapeHtml(durationMinutes)}</span>`;
    html = `${typeHtml}(${durationHtml})として`;
  } else if (hasDuration) {
    const durationHtml = `<span class="p-duration" data-duration="${escapeHtml(
      String(event.talk_duration)
    )}">${escapeHtml(durationSlot)}</span>`;
    html = `${durationHtml}として`;
  } else if (type) {
    html = `<span class="p-category">${escapeHtml(type)}</span>として`;
  }

  return { html, text };
}

function buildEventNarrative(event) {
  if (!event || typeof event !== "object") return null;
  const name = typeof event.name === "string" ? event.name.trim() : "";
  if (!name) return null;

  const presentedAtRaw = typeof event.presented_at === "string" ? event.presented_at : "";
  let eventJapaneseDate = "";
  if (presentedAtRaw) {
    const eventDate = new Date(presentedAtRaw);
    if (!Number.isNaN(eventDate.valueOf())) {
      eventJapaneseDate = `${eventDate.getFullYear()}年${eventDate.getMonth() + 1}月${eventDate.getDate()}日`;
    }
  }
  const timeLabel = eventJapaneseDate || presentedAtRaw || "";
  const timeHtml = presentedAtRaw
    ? `<time class="dt-start" datetime="${escapeHtml(presentedAtRaw)}">${escapeHtml(timeLabel)}</time>`
    : "";
  const timeSegmentHtml = timeHtml ? `${timeHtml}に` : "";
  const timeSegmentText = timeLabel ? `${timeLabel}に` : "";

  const locationHtmlSegments = [];
  const locationTextSegments = [];
  if (typeof event.location === "string" && event.location.trim()) {
    locationHtmlSegments.push(`<span class="p-location">${escapeHtml(event.location.trim())}</span>`);
    locationTextSegments.push(event.location.trim());
  }
  if (typeof event.place === "string" && event.place.trim()) {
    locationHtmlSegments.push(`<span class="p-location">${escapeHtml(event.place.trim())}</span>`);
    locationTextSegments.push(event.place.trim());
  }
  const locationSegmentHtml = locationHtmlSegments.length ? `${locationHtmlSegments.join("の")}で` : "";
  const locationSegmentText = locationTextSegments.length ? `${locationTextSegments.join("の")}で` : "";

  const url = typeof event.url === "string" ? event.url : "";
  const nameHtml = url
    ? `<a href="${escapeHtml(url)}" class="p-name u-url" target="_blank" rel="noopener">${escapeHtml(name)}</a>`
    : `<span class="p-name">${escapeHtml(name)}</span>`;
  const role = buildEventRoleSegment(event);

  const roleHtmlSegment = role.html ? `で${role.html}` : "";
  const roleTextSegment = role.text ? `で${role.text}` : "";

  const sentenceHtml = `${timeSegmentHtml}${locationSegmentHtml}開催された『${nameHtml}』${roleHtmlSegment}発表しました。`;
  const sentenceText = `${timeSegmentText}${locationSegmentText}開催された『${name}』${roleTextSegment}発表しました。`
    .replace(/\s+/g, " ")
    .trim();

  return {
    html: `<p class="event-entry h-event">${sentenceHtml}</p>`,
    text: sentenceText,
  };
}
