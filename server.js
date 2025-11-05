import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getSlideBySlug } from "./lib/slides.js";
import { renderNode, escapeHtml } from "./lib/html.js";
import { loadSiteConfig } from "./lib/site-config.js";
import { loadPdfMeta } from "./lib/pdf-meta.js";
import { generateSlidesData } from "./lib/slides-data.js";
import { serveStatic } from "./lib/static-server.js";
import { buildEventNarratives } from "./lib/events.js";

const app = new Hono();

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
          <link rel="canonical" href="https://zonuexe.github.io/slides/">
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
              `<p class="slide-card-event h-event"><i class="fa-solid fa-microphone-lines" aria-hidden="true"></i> <span class="p-name">${escapeHtml(event.name)}</span>${presentedAt
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
    const pdfMeta = await loadPdfMeta(slide);
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

    const eventNarratives = buildEventNarratives(slide.events);

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

          <link rel="alternate" type="application/json+oembed" href="${config.site.url}/slides/${slide.slug}/oembed.json">
          <link rel="alternate" type="text/xml+oembed" href="${config.site.url}/slides/${slide.slug}/oembed.xml">
          <link rel="alternate" type="application/pdf" href="${config.site.url}${slidePath}">
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
