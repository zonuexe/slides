import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { loadSiteConfig } from "../../../lib/site-config.js";

const execFileAsync = promisify(execFile);

// ローカルモードは dev サーバー専用。configureServer にだけ実装があり、
// npm run build の出力には一切現れない (未コミットの手元のファイルを
// 公開ビルドに混ぜないため)。
const MOUNT = "/slides/local";
const VIEWER_PREFIX = `${MOUNT}/viewer/`;
const PDF_PREFIX = `${MOUNT}/pdf/`;

// 隣に checkout があればそれを同一オリジンで配信する。無ければ本番の
// slide-pdf.js をプロキシする。いずれにせよビューアを localhost 側に
// 置くのが要点で、https のビューアから http://localhost の PDF は
// ブラウザに素通しでブロックされる (CORS ヘッダでは解決しない)。
const VIEWER_CHECKOUT = "../slide-pdf.js";

const MIME_TYPES = {
  ".bcmap": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const DEFAULT_PAGE_SIZE = { width: 1920, height: 1080 };

// PDF のページ寸法をスキャンする上限。先頭から見つからなければ既定値に倒す。
const MEDIABOX_SCAN_LIMIT = 32 * 1024 * 1024;

function contentTypeFor(path) {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// path が baseDir の中に収まるときだけ絶対パスを返す (ディレクトリ抜け対策)。
function resolveWithin(baseDir, relativePath) {
  const target = resolve(baseDir, relativePath);
  if (target !== baseDir && !target.startsWith(baseDir + sep)) {
    return null;
  }
  return target;
}

async function gitPaths(root, args) {
  const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean);
}

// リポジトリルートにある未コミットの PDF を新しい順で返す。「未コミット」は
// 追跡されていないものと、追跡済みでも HEAD から変更されているものの両方。
// git が使えない場合はルートの PDF をすべてローカル扱いにする。
async function listLocalPdfs(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const rootPdfs = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => entry.name);

  let committed = new Set();
  try {
    const tracked = await gitPaths(root, ["ls-files", "-z", "--", "*.pdf"]);
    const dirty = new Set(await gitPaths(root, ["diff", "--name-only", "-z", "HEAD", "--", "*.pdf"]));
    committed = new Set(tracked.filter((path) => !path.includes("/") && !dirty.has(path)));
  } catch {
    // git が無い / リポジトリでない
  }

  const local = [];
  for (const name of rootPdfs) {
    if (committed.has(name)) continue;
    const fileStat = await stat(resolve(root, name));
    local.push({ name, size: fileStat.size, mtime: fileStat.mtime });
  }
  return local.sort((a, b) => b.mtime - a.mtime);
}

// 1 ページ目の /MediaBox からページ寸法を拾う。オブジェクトストリームに
// 圧縮されていると読めないので、その場合は 16:9 に倒す。
async function readPageSize(pdfPath) {
  try {
    const fileStat = await stat(pdfPath);
    if (fileStat.size > MEDIABOX_SCAN_LIMIT) {
      return DEFAULT_PAGE_SIZE;
    }
    const buffer = await readFile(pdfPath);
    const match = buffer.toString("latin1").match(/\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*\]/);
    if (!match) {
      return DEFAULT_PAGE_SIZE;
    }
    const width = Math.abs(Number(match[3]) - Number(match[1]));
    const height = Math.abs(Number(match[4]) - Number(match[2]));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return DEFAULT_PAGE_SIZE;
    }
    return { width, height };
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

const PAGE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.5rem 4rem;
    background: #1b1b1f;
    color: rgba(255, 255, 255, 0.87);
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    line-height: 1.7;
  }
  main { max-width: 1180px; margin: 0 auto; }
  a { color: #a8b1ff; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  .lede { margin: 0 0 2rem; color: rgba(235, 235, 245, 0.6); font-size: 0.9rem; }
  .badge {
    display: inline-block; margin-left: 0.6rem; padding: 0.1rem 0.5rem;
    border: 1px solid #4b5563; border-radius: 999px;
    font-size: 0.7rem; letter-spacing: 0.08em; vertical-align: 0.2em;
    color: rgba(235, 235, 245, 0.6);
  }
  .deck-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
  .deck-item a {
    display: block; padding: 1rem 1.25rem;
    background: #202127; border: 1px solid #2e2e32; border-radius: 10px;
    text-decoration: none; color: inherit;
  }
  .deck-item a:hover { border-color: #a8b1ff; }
  .deck-name { font-weight: 600; word-break: break-all; }
  .deck-meta { color: rgba(235, 235, 245, 0.6); font-size: 0.82rem; }
  .empty {
    padding: 2rem; border: 1px dashed #3a3a40; border-radius: 10px;
    color: rgba(235, 235, 245, 0.6);
  }
  code { background: #2a2a32; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.85em; }
  .stage { display: flex; justify-content: center; margin-bottom: 1rem; }
  .stage-frame { background: #000; border-radius: 8px; overflow: hidden; }
  .stage-frame iframe { display: block; width: 100%; height: 100%; border: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1.5rem; }
  .actions a {
    padding: 0.4rem 0.9rem; border: 1px solid #3a3a40; border-radius: 6px;
    text-decoration: none; font-size: 0.85rem;
  }
  .actions a:hover { border-color: #a8b1ff; }
  .notice {
    padding: 1rem 1.25rem; border: 1px solid #6b4a1f; border-radius: 8px;
    background: #2a2117; font-size: 0.88rem;
  }
  .notice pre { overflow-x: auto; background: #1b1b1f; padding: 0.75rem; border-radius: 6px; }
`;

function renderPage({ title, body }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function renderIndexPage(decks) {
  const list = decks.length
    ? `<ul class="deck-list">${decks
        .map(
          (deck) => `<li class="deck-item"><a href="${MOUNT}/${encodeURIComponent(deck.name)}/">
  <div class="deck-name">${escapeHtml(deck.name)}</div>
  <div class="deck-meta">${formatBytes(deck.size)} / ${formatDate(deck.mtime)}</div>
</a></li>`
        )
        .join("\n")}</ul>`
    : `<p class="empty">リポジトリルートに未コミットの PDF がありません。公開したい PDF をリポジトリルート
       (<code>${escapeHtml(process.cwd())}</code>) に置くとここに並びます。</p>`;

  return renderPage({
    title: "ローカルモード | tadsan's slide deck",
    body: `<h1>ローカルモード<span class="badge">dev only</span></h1>
<p class="lede">リポジトリルートにある未コミットの PDF を、公開前にそのまま再生します。このページはビルド出力には含まれません。</p>
${list}
<div class="actions" style="margin-top:2rem"><a href="/slides/">スライド一覧に戻る</a></div>`,
  });
}

function renderPlayerPage({ name, size, mtime, pageSize }) {
  const encoded = encodeURIComponent(name);
  const pdfUrl = `${PDF_PREFIX}${encoded}`;
  const viewerUrl = `${VIEWER_PREFIX}?slide=${encodeURIComponent(pdfUrl)}`;
  // 画面が低いときにアスペクト比を崩さないよう、高さの上限を幅の上限に換算する
  // (SlideDetailPage.vue と同じ考え方)。
  const maxHeightVh = 78;
  const heightBoundWidthVh = ((maxHeightVh * pageSize.width) / pageSize.height).toFixed(2);

  return renderPage({
    title: `${name} | ローカルモード`,
    body: `<div class="stage">
  <div class="stage-frame" style="width: min(100%, ${pageSize.width}px, ${heightBoundWidthVh}vh); aspect-ratio: ${pageSize.width} / ${pageSize.height};">
    <iframe src="${escapeHtml(viewerUrl)}" title="${escapeHtml(name)}" scrolling="no" allowfullscreen></iframe>
  </div>
</div>
<h1>${escapeHtml(name)}<span class="badge">dev only</span></h1>
<p class="lede">${formatBytes(size)} / ${formatDate(mtime)} / ${pageSize.width}&times;${pageSize.height}</p>
<div class="actions">
  <a href="${escapeHtml(pdfUrl)}" download="${escapeHtml(name)}">PDF をダウンロード</a>
  <a href="${escapeHtml(viewerUrl)}" target="_blank">ビューアを単体で開く</a>
  <a href="${MOUNT}/">ローカルモードの一覧</a>
  <a href="/slides/">スライド一覧に戻る</a>
</div>`,
  });
}

function renderMissingPage(name) {
  return renderPage({
    title: "見つかりません | ローカルモード",
    body: `<h1>見つかりません</h1>
<p class="lede"><code>${escapeHtml(name)}</code> はリポジトリルートの未コミット PDF の中にありません。</p>
<div class="actions"><a href="${MOUNT}/">ローカルモードの一覧</a></div>`,
  });
}

export function localModePlugin() {
  const root = resolve(process.cwd());
  const viewerDir = resolve(root, VIEWER_CHECKOUT);

  let viewerSourcePromise = null;

  // ビューアの供給元を一度だけ決める: 隣の checkout があればそれ、無ければ本番のプロキシ。
  function resolveViewerSource() {
    if (!viewerSourcePromise) {
      viewerSourcePromise = (async () => {
        try {
          const indexStat = await stat(resolve(viewerDir, "index.html"));
          if (indexStat.isFile()) {
            return { kind: "checkout", dir: viewerDir };
          }
        } catch {
          // checkout が無いのでプロキシに倒す
        }
        const site = await loadSiteConfig();
        const base = (site.embed?.base_url ?? "https://zonuexe.github.io/slide-pdf.js").replace(/\/$/, "");
        return { kind: "proxy", base };
      })();
    }
    return viewerSourcePromise;
  }

  async function serveViewer(req, res, subPath) {
    const source = await resolveViewerSource();
    const relativePath = subPath === "" || subPath.endsWith("/") ? `${subPath}index.html` : subPath;

    if (source.kind === "checkout") {
      const target = resolveWithin(source.dir, relativePath);
      if (!target) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const fileStat = await stat(target);
      if (!fileStat.isFile()) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Type", contentTypeFor(target));
      res.setHeader("Content-Length", fileStat.size);
      createReadStream(target).pipe(res);
      return;
    }

    const upstream = await fetch(`${source.base}/${relativePath}`);
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    res.end(Buffer.from(await upstream.arrayBuffer()));
  }

  async function serveLocalPdf(res, name) {
    const target = resolveWithin(root, name);
    if (!target || name.includes("/")) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const decks = await listLocalPdfs(root);
    if (!decks.some((deck) => deck.name === name)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const fileStat = await stat(target);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", fileStat.size);
    createReadStream(target).pipe(res);
  }

  function sendHtml(res, html, statusCode = 200) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  }

  return {
    name: "local-mode-plugin",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [rawPath] = (req.url || "").split("?");
        if (rawPath !== MOUNT && !rawPath.startsWith(`${MOUNT}/`)) {
          next();
          return;
        }

        const handler = async () => {
          if (rawPath === MOUNT) {
            res.statusCode = 302;
            res.setHeader("Location", `${MOUNT}/`);
            res.end();
            return;
          }

          if (rawPath.startsWith(VIEWER_PREFIX)) {
            await serveViewer(req, res, decodeURIComponent(rawPath.slice(VIEWER_PREFIX.length)));
            return;
          }

          if (rawPath.startsWith(PDF_PREFIX)) {
            await serveLocalPdf(res, decodeURIComponent(rawPath.slice(PDF_PREFIX.length)));
            return;
          }

          const decks = await listLocalPdfs(root);

          if (rawPath === `${MOUNT}/`) {
            sendHtml(res, renderIndexPage(decks));
            return;
          }

          const name = decodeURIComponent(rawPath.slice(MOUNT.length + 1).replace(/\/$/, ""));
          const deck = decks.find((entry) => entry.name === name);
          if (!deck) {
            sendHtml(res, renderMissingPage(name), 404);
            return;
          }
          const pageSize = await readPageSize(resolve(root, deck.name));
          sendHtml(res, renderPlayerPage({ ...deck, pageSize }));
        };

        handler().catch(next);
      });
    },
  };
}
