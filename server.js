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
          <link rel="stylesheet" href="/slides/css/slide.css">
          <style>
            :root {
              --max-width: ${maxWidth}px;
              --aspect-ratio: ${maxWidth} / ${maxHeight};
              --max-height: 66.67vh;
            }
          </style>
          <script>
            function toggleExpanded() {
              const iframe = document.getElementById('pdf-container');
              const controls = document.querySelector('.pdf-controls');
              const fullscreenBtn = document.querySelector('.fullscreen-btn');
              const icon = fullscreenBtn.querySelector('i');

              if (!iframe.classList.contains('expanded')) {
                // 画面全体表示に切り替え
                iframe.classList.add('expanded');
                controls.classList.add('expanded');

                // スライド情報と戻るリンクを非表示
                const slideInfo = document.querySelector('.slide-info');
                const backLink = document.querySelector('.back-link');
                if (slideInfo) slideInfo.classList.add('expanded');
                if (backLink) backLink.classList.add('expanded');

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

                // スライド情報と戻るリンクを再表示
                const slideInfo = document.querySelector('.slide-info');
                const backLink = document.querySelector('.back-link');
                if (slideInfo) slideInfo.classList.remove('expanded');
                if (backLink) backLink.classList.remove('expanded');

                iframe.style.width = '';
                iframe.style.height = '';
                icon.className = 'fa-solid fa-expand';
                fullscreenBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
              }
            }

            // ファイル名から拡張子を取り除く関数
            function base(filename) {
              const lastDotIndex = filename.lastIndexOf('.');
              return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
            }

            // 現在のページ番号を取得する関数
            function getCurrentPageNumber() {
              try {
                const iframe = document.getElementById('pdf-container');
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

                // #pdf-container の data-page 属性からページ番号を取得
                const pdfContainer = iframeDoc.getElementById('pdf-container');
                if (pdfContainer && pdfContainer.dataset.page) {
                  const pageNumber = parseInt(pdfContainer.dataset.page);
                  if (!isNaN(pageNumber) && pageNumber > 0) {
                    return pageNumber;
                  }
                }

                // デフォルトは1ページ目
                return 1;
              } catch (error) {
                console.error('ページ番号の取得に失敗しました:', error);
                return 1;
              }
            }

            // ページ変更を監視する関数
            function watchPageChanges() {
              const iframe = document.getElementById('pdf-container');
              if (!iframe) return;

              // iframeの読み込み完了を待つ
              iframe.addEventListener('load', function() {
                try {
                  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

                  // MutationObserverでページ変更を監視
                  const observer = new MutationObserver(function(mutations) {
                    mutations.forEach(function(mutation) {
                      if (mutation.type === 'childList' || mutation.type === 'attributes') {
                        // ページ変更を検知したら、ボタンのファイル名を更新
                        updateButtonFilenames();
                      }
                    });
                  });

                  // #pdf-container の data-page 属性の変更を監視
                  const pdfContainer = iframeDoc.getElementById('pdf-container');
                  if (pdfContainer) {
                    observer.observe(pdfContainer, {
                      attributes: true,
                      attributeFilter: ['data-page']
                    });
                  }

                  // ページ要素の変更を監視
                  observer.observe(iframeDoc.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['class', 'style']
                  });

                  // キーボードイベントでページ変更を監視
                  iframeDoc.addEventListener('keydown', function(event) {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
                        event.key === 'PageUp' || event.key === 'PageDown') {
                      // 少し遅延させてからファイル名を更新（PDF.jsの処理完了を待つ）
                      setTimeout(updateButtonFilenames, 100);
                    }
                  });

                  // クリックイベントでページ変更を監視
                  iframeDoc.addEventListener('click', function(event) {
                    // ナビゲーションボタンのクリックを検知
                    if (event.target.closest('.navButton, .pageButton, [class*="nav"], [class*="page"]')) {
                      setTimeout(updateButtonFilenames, 100);
                    }
                  });

                } catch (error) {
                  console.error('ページ変更監視の設定に失敗しました:', error);
                }
              });
            }

            // ボタンのファイル名を更新する関数
            function updateButtonFilenames() {
              const downloadBtn = document.querySelector('.download-image-btn');
              const copyBtn = document.querySelector('.copy-image-btn');

              if (downloadBtn && copyBtn) {
                const slideDownload = '${slide.download}';
                const baseName = base(slideDownload);
                const pageNumber = getCurrentPageNumber();
                const filename = baseName + '-' + pageNumber + '.png';

                // ボタンのツールチップを更新（現在のページ番号を明確に表示）
                downloadBtn.title = 'Save page ' + pageNumber + ' as: ' + filename;
                copyBtn.title = 'Copy page ' + pageNumber + ' as: ' + filename;

                // コンソールに現在のページ番号を表示（デバッグ用）
                console.log('Current page:', pageNumber, 'Filename:', filename);
              }
            }

            // 現在の表示を画像としてダウンロード
            function downloadCanvasAsImage() {
              try {
                const iframe = document.getElementById('pdf-container');
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

                // iframe内のcanvas要素を探す
                const canvas = iframeDoc.querySelector('canvas');

                if (canvas) {
                  // ファイル名を生成
                  const slideDownload = '${slide.download}';
                  const baseName = base(slideDownload);
                  const pageNumber = getCurrentPageNumber();
                  const filename = baseName + '-' + pageNumber + '.png';

                  // canvasを画像に変換
                  const dataURL = canvas.toDataURL('image/png');

                  // ダウンロードリンクを作成
                  const link = document.createElement('a');
                  link.download = filename;
                  link.href = dataURL;

                  // クリックしてダウンロード
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                } else {
                  // canvasが見つからない場合の代替手段
                  // html2canvas(iframe) は外部ライブラリが必要
                  alert('画像のダウンロードに失敗しました。iframe内のcanvas要素が見つからないか、同一オリジンポリシーによりアクセスできません。');
                }
              } catch (error) {
                console.error('画像ダウンロードに失敗しました:', error);
                alert('画像のダウンロードに失敗しました。iframe内のコンテンツにアクセスできません。');
              }
            }

            // 現在の表示をクリップボードにコピー
            async function copyCanvasToClipboard() {
              try {
                const iframe = document.getElementById('pdf-container');
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

                // iframe内のcanvas要素を探す
                const canvas = iframeDoc.querySelector('canvas');

                if (canvas) {
                  // canvasをBlobに変換
                  canvas.toBlob(async (blob) => {
                    try {
                      // クリップボードに画像をコピー
                      await navigator.clipboard.write([
                        new ClipboardItem({
                          'image/png': blob
                        })
                      ]);
                      showToast('画像がクリップボードにコピーされました！', 'success');
                    } catch (clipboardError) {
                      console.error('クリップボードへのコピーに失敗しました:', clipboardError);
                      showToast('クリップボードへのコピーに失敗しました。ブラウザが対応していない可能性があります。', 'error');
                    }
                  }, 'image/png');
                } else {
                  // canvasが見つからない場合の代替手段
                  // html2canvas(iframe) は外部ライブラリが必要
                  showToast('画像のクリップボードコピーに失敗しました。iframe内のcanvas要素が見つからないか、同一オリジンポリシーによりアクセスできません。', 'error');
                }
              } catch (error) {
                console.error('画像のクリップボードコピーに失敗しました:', error);
                showToast('画像のクリップボードコピーに失敗しました。iframe内のコンテンツにアクセスできません。', 'error');
              }
            }

            // Toast通知を表示する関数
            function showToast(message, type = 'success') {
              const toast = document.getElementById('toast');
              toast.textContent = message;
              toast.className = 'toast ' + type;

              // 表示
              setTimeout(() => {
                toast.classList.add('show');
              }, 100);

              // 3秒後に自動で非表示
              setTimeout(() => {
                toast.classList.remove('show');
              }, 3000);
            }

            // ウィンドウリサイズ時にサイズを再調整
            window.addEventListener('resize', function() {
              const iframe = document.getElementById('pdf-container');
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

            // ページ変更監視を開始（iframe読み込み完了後）
            document.addEventListener('DOMContentLoaded', function() {
              // iframeが既に読み込まれている場合
              const iframe = document.querySelector('.pdf-container');
              if (iframe && iframe.contentDocument) {
                watchPageChanges();
              } else {
                // iframeの読み込み完了を待つ
                iframe.addEventListener('load', watchPageChanges);
              }
            });
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
