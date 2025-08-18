import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { loadSlides, getSlideBySlug } from "./lib/slides.js";
import { createReadStream } from "fs";
import { stat } from "fs/promises";

const app = new Hono();

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
              `).join('')}
            </div>
          </div>
        </body>
      </html>
    `;

    return c.html(html);
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
    const maxWidth = slide.max_width || 1024;
    const maxHeight = slide.max_height || 768;

    const html = `
      <!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${slide.title}</title>
          <script src="https://kit.fontawesome.com/ca9a253b70.js" crossorigin="anonymous"></script>
          <style>
            body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
            .pdf-container {
              width: 100%;
              max-width: ${maxWidth}px;
              aspect-ratio: ${maxWidth} / ${maxHeight};
              border: none;
              margin: 0 auto 20px auto;
              display: block;
            }
            .pdf-controls {
              display: flex;
              justify-content: center;
              gap: 10px;
              margin-bottom: 20px;
            }
            .fullscreen-btn {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              background: #28a745;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 500;
              transition: background-color 0.2s;
              border: none;
              cursor: pointer;
              font-size: 14px;
            }
            .fullscreen-btn:hover {
              background: #218838;
            }
            .fullscreen-btn i {
              font-size: 16px;
            }
            .slide-info { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }

            /* 画面全体表示時のスタイル */
            .pdf-container.expanded {
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              max-width: 100vw;
              max-height: 100vh;
              aspect-ratio: auto;
              margin: 0;
              z-index: 1000;
              background: white;
              overflow: hidden;
            }

            /* 画面全体表示時のボタン位置調整 */
            .pdf-controls.expanded {
              position: fixed;
              top: 20px;
              right: 20px;
              z-index: 1001;
            }

            /* 画面全体表示時の縮小ボタンスタイル */
            .pdf-controls.expanded .fullscreen-btn {
              background: #6c757d;
              color: white;
              padding: 8px;
              border-radius: 50%;
              width: 40px;
              height: 40px;
              display: flex;
              align-items: center;
              justify-content: center;
              min-width: auto;
            }

            .pdf-controls.expanded .fullscreen-btn:hover {
              background: #5a6268;
            }

            .pdf-controls.expanded .fullscreen-btn i {
              font-size: 14px;
            }
            .slide-info h1 { margin-top: 0; color: #333; }
            .slide-info time { color: #666; font-weight: 500; }
            .download-btn { display: inline-flex; align-items: center; gap: 8px; background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; transition: background-color 0.2s; }
            .download-btn:hover { background: #0056b3; }
            .download-btn i { font-size: 16px; }
            .hashtags { margin-top: 10px; }
            .hashtag { background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-right: 8px; text-decoration: none; color: #495057; transition: background-color 0.2s; }
            .hashtag:hover { background: #dee2e6; }
          </style>
          <script>
            function toggleExpanded() {
              const iframe = document.querySelector('.pdf-container');
              const controls = document.querySelector('.pdf-controls');
              const fullscreenBtn = document.querySelector('.fullscreen-btn');
              const icon = fullscreenBtn.querySelector('i');

              if (!iframe.classList.contains('expanded')) {
                // 画面全体表示に切り替え
                iframe.classList.add('expanded');
                controls.classList.add('expanded');

                // 画面サイズに応じて適切なサイズを設定
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const aspectRatio = ${maxWidth} / ${maxHeight};

                // アスペクト比を保ちながら画面に完全に収まるサイズを計算
                let calculatedWidth, calculatedHeight;

                if (viewportWidth / aspectRatio <= viewportHeight) {
                  // 横幅基準で画面に収まる場合
                  calculatedWidth = viewportWidth;
                  calculatedHeight = viewportWidth / aspectRatio;
                } else {
                  // 縦幅基準で画面に収まる場合
                  calculatedHeight = viewportHeight;
                  calculatedWidth = viewportHeight * aspectRatio;
                }

                iframe.style.width = calculatedWidth + 'px';
                iframe.style.height = calculatedHeight + 'px';

                icon.className = 'fa-solid fa-compress';
                fullscreenBtn.innerHTML = '<i class="fa-solid fa-compress"></i>';
              } else {
                // 通常表示に戻す
                iframe.classList.remove('expanded');
                controls.classList.remove('expanded');
                iframe.style.width = '';
                iframe.style.height = '';
                icon.className = 'fa-solid fa-expand';
                fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>画面全体表示';
              }
            }

            // ウィンドウリサイズ時にサイズを再調整
            window.addEventListener('resize', function() {
              const iframe = document.querySelector('.pdf-container');
              if (iframe.classList.contains('expanded')) {
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const aspectRatio = ${maxWidth} / ${maxHeight};

                let calculatedWidth, calculatedHeight;

                if (viewportWidth / aspectRatio <= viewportHeight) {
                  // 横幅基準で画面に収まる場合
                  calculatedWidth = viewportWidth;
                  calculatedHeight = viewportWidth / aspectRatio;
                } else {
                  // 縦幅基準で画面に収まる場合
                  calculatedHeight = viewportHeight;
                  calculatedWidth = viewportHeight * aspectRatio;
                }

                iframe.style.width = calculatedWidth + 'px';
                iframe.style.height = calculatedHeight + 'px';
              }
            });
          </script>
        </head>
        <body>
          <div class="container">
            <iframe src="${pdfUrl}" class="pdf-container" title="${slide.title}"></iframe>
            <div class="pdf-controls">
              <button class="fullscreen-btn" onclick="toggleExpanded()">
                <i class="fa-solid fa-expand"></i>
                画面全体表示
              </button>
            </div>

            <div class="slide-info">
              <h1>${slide.title}</h1>
              <p>公開日: <time datetime="${slide.date}">${japaneseDate}</time></p>

              ${slide.hashtags && slide.hashtags.length > 0 ? `
                <div class="hashtags">
                  ${slide.hashtags.map(tag => `<a href="https://twitter.com/hashtag/${tag}" target="_blank" rel="noopener noreferrer" class="hashtag">#${tag}</a>`).join('')}
                </div>
              ` : ''}

              <div style="margin-top: 20px;">
                <a href="${slidePath}" download="${slide.download}">
                  <button class="download-btn">
                    <i class="fa-solid fa-download"></i> Download PDF
                  </button>
                </a>
              </div>
            </div>
        </body>
      </html>
    `;

    return c.html(html);
  } catch (error) {
    console.error('Error loading slide:', error);
    return c.text('スライドの読み込みに失敗しました', 500);
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

// slide-pdf.js のルートディレクトリアクセス
app.get("/slide-pdf.js/", async (c) => {
  try {
    const filePath = `../slide-pdf.js/index.html`;
    const stats = await stat(filePath);

    if (stats.isFile()) {
      const stream = createReadStream(filePath);
      return new Response(stream, {
        headers: { "Content-Type": "text/html" },
      });
    } else {
      return c.text("index.htmlが見つかりません", 404);
    }
  } catch (error) {
    return c.text("index.htmlが見つかりません", 404);
  }
});

// slide-pdf.js のルートディレクトリアクセス（末尾スラッシュなし）
app.get("/slide-pdf.js", async (c) => {
  try {
    const filePath = `../slide-pdf.js/index.html`;
    const stats = await stat(filePath);

    if (stats.isFile()) {
      const stream = createReadStream(filePath);
      return new Response(stream, {
        headers: { "Content-Type": "text/html" },
      });
    } else {
      return c.text("index.htmlが見つかりません", 404);
    }
  } catch (error) {
    return c.text("index.htmlが見つかりません", 404);
  }
});

console.log("🚀 Hono server is running on http://localhost:3000");

// Node.js用のサーバー起動
serve({
  fetch: app.fetch,
  port: 3000
});
