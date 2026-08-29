import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { extname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { loadSiteConfig } from "../../../lib/site-config.js";
import { loadLocalPaths, LOCAL_CONFIG_FILE } from "../../../lib/local-config.js";

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

// リポジトリに「コミット済みでそのまま」の PDF のパス集合 (リポジトリ相対)。
// これに載っているものだけ一覧から外す。つまり未追跡のものと、追跡済みでも
// HEAD から変更されているものは残る。git が使えなければ null。
async function committedPdfs(root) {
  try {
    const tracked = await gitPaths(root, ["ls-files", "-z", "--", "*.pdf"]);
    const dirty = new Set(await gitPaths(root, ["diff", "--name-only", "-z", "HEAD", "--", "*.pdf"]));
    return new Set(tracked.filter((path) => !dirty.has(path)));
  } catch {
    return null;
  }
}

// 設定された各ディレクトリの直下から PDF を集める。再帰はしない
// (~/Documents のような大きなディレクトリを毎回走査したくない)。
// リポジトリの中を指しているディレクトリにだけコミット済みの除外をかける。
async function listLocalPdfs(root, sources) {
  const committed = await committedPdfs(root);
  const decks = [];
  const seen = new Set();

  for (const source of sources) {
    let entries;
    try {
      entries = await readdir(source.dir, { withFileTypes: true });
    } catch {
      // 設定されていても存在しないディレクトリは黙って飛ばす
      continue;
    }

    const insideRepo = source.dir === root || source.dir.startsWith(root + sep);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }
      const path = resolve(source.dir, entry.name);
      if (seen.has(path)) {
        continue;
      }
      if (insideRepo && committed?.has(relative(root, path).split(sep).join("/"))) {
        continue;
      }
      let fileStat;
      try {
        fileStat = await stat(path);
      } catch {
        continue;
      }
      seen.add(path);
      decks.push({
        // パスから引いた安定した ID。ファイル名だとディレクトリを跨いで
        // 衝突しうるうえ、この ID 経由でしか配信しないので経路も塞げる。
        id: createHash("sha1").update(path).digest("hex").slice(0, 12),
        name: entry.name,
        path,
        source: source.entry,
        size: fileStat.size,
        mtime: fileStat.mtime,
      });
    }
  }

  return decks.sort((a, b) => b.mtime - a.mtime);
}

function positiveSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

// poppler の pdfinfo。入っていればページ数と寸法の両方が一度に、確実に取れる。
async function probePdfinfo(pdfPath) {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath], { maxBuffer: 1024 * 1024 });
  const pages = Number(stdout.match(/^Pages:\s+(\d+)$/m)?.[1]);
  const sizeMatch = stdout.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
  return {
    pages: Number.isInteger(pages) && pages > 0 ? pages : null,
    pageSize: sizeMatch ? positiveSize(Number(sizeMatch[1]), Number(sizeMatch[2])) : null,
  };
}

// macOS の Spotlight メタデータ。標準で入っているが、索引されていない
// ファイルや PDF として読めないファイルでは "(null)" を返す。
async function probeMdls(pdfPath) {
  const { stdout } = await execFileAsync("mdls", ["-name", "kMDItemNumberOfPages", "-raw", pdfPath]);
  const pages = Number(stdout.trim());
  return { pages: Number.isInteger(pages) && pages > 0 ? pages : null, pageSize: null };
}

// Ghostscript。サムネイル生成で使うので add_new_slides.py が動く環境には必ずある。
async function probeGhostscript(pdfPath) {
  const { stdout } = await execFileAsync("gs", [
    "-q",
    "-dNODISPLAY",
    "-dNOSAFER",
    "-c",
    `(${pdfPath}) (r) file runpdfbegin pdfpagecount = quit`,
  ]);
  const pages = Number(stdout.trim());
  return { pages: Number.isInteger(pages) && pages > 0 ? pages : null, pageSize: null };
}

// 1 ページ目の /MediaBox を直接読む。オブジェクトストリームに圧縮されていると
// 読めないので、外部コマンドが一つも使えないときの最後の砦。
async function scanMediaBox(pdfPath, fileSize) {
  if (fileSize > MEDIABOX_SCAN_LIMIT) {
    return null;
  }
  const buffer = await readFile(pdfPath);
  const match = buffer
    .toString("latin1")
    .match(/\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*\]/);
  if (!match) {
    return null;
  }
  return positiveSize(Math.abs(Number(match[3]) - Number(match[1])), Math.abs(Number(match[4]) - Number(match[2])));
}

// ページ数と寸法。外部コマンドを順に試し、どれも無ければ寸法だけ自前で拾う。
// ページ数が取れないときは null のまま (推測した数字を出すより出さない)。
async function inspectPdf(pdfPath, fileStat) {
  let pages = null;
  let pageSize = null;

  for (const probe of [probePdfinfo, probeMdls, probeGhostscript]) {
    try {
      const result = await probe(pdfPath);
      pages = pages ?? result.pages;
      pageSize = pageSize ?? result.pageSize;
    } catch {
      // コマンドが無い / この PDF では失敗した。次を試す
    }
    if (pages && pageSize) break;
  }

  if (!pageSize) {
    try {
      pageSize = await scanMediaBox(pdfPath, fileStat.size);
    } catch {
      // 読めなければ既定値
    }
  }

  return { pages, pageSize: pageSize ?? DEFAULT_PAGE_SIZE };
}

// 同じファイルを開き直すたびに外部コマンドを叩かないための小さなキャッシュ。
// サイズか mtime が動けばキーが変わるので、差し替えた PDF は自動で読み直す。
const inspectionCache = new Map();

async function inspectPdfCached(pdfPath, fileStat) {
  const key = `${pdfPath}:${fileStat.size}:${fileStat.mtimeMs}`;
  const cached = inspectionCache.get(key);
  if (cached) {
    return cached;
  }
  const result = await inspectPdf(pdfPath, fileStat);
  inspectionCache.set(key, result);
  return result;
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
  .actions a, .actions button {
    padding: 0.4rem 0.9rem; border: 1px solid #3a3a40; border-radius: 6px;
    text-decoration: none; font-size: 0.85rem;
    font-family: inherit; line-height: inherit;
    background: transparent; color: #a8b1ff; cursor: pointer;
  }
  .actions a:hover, .actions button:hover:not(:disabled) { border-color: #a8b1ff; }
  .actions button:disabled { color: rgba(235, 235, 245, 0.4); cursor: not-allowed; }
`;

// 全画面はビューアの iframe 自体を対象にする。iframe が画面いっぱいになると
// 中の slide-pdf.js が resize を拾ってページを描き直すので、こちら側で
// レイアウトを作り込む必要がない。フォーカスも iframe に移すので、そのまま
// 矢印キーでページを送れる。
const PLAYER_SCRIPT = `
  (function () {
    var frame = document.getElementById("js-viewer");
    var button = document.getElementById("js-fullscreen");
    var request = frame.requestFullscreen || frame.webkitRequestFullscreen;
    if (!request) {
      button.disabled = true;
      button.title = "このブラウザは全画面表示に対応していません";
      return;
    }
    button.addEventListener("click", function () {
      try {
        // 返り値の Promise には頼らない。全画面を与えない環境 (埋め込みの
        // ブラウザビューなど) では解決も棄却もせず宙吊りになる。実際に
        // 全画面になったかどうかは fullscreenchange だけを見る。
        var result = request.call(frame);
        if (result && typeof result.catch === "function") {
          result.catch(function (error) {
            console.error("全画面表示に失敗しました", error);
          });
        }
      } catch (error) {
        console.error("全画面表示に失敗しました", error);
      }
    });
    function onFullscreenChange() {
      var current = document.fullscreenElement || document.webkitFullscreenElement;
      if (current === frame) {
        // フォーカスを iframe に移しておくと、そのまま矢印キーでページを送れる。
        frame.focus();
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  })();
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

function renderIndexPage(decks, sources) {
  const sourceList = sources.map((source) => `<code>${escapeHtml(source.entry)}</code>`).join(" ");
  const list = decks.length
    ? `<ul class="deck-list">${decks
        .map(
          (deck) => `<li class="deck-item"><a href="${MOUNT}/${deck.id}/">
  <div class="deck-name">${escapeHtml(deck.name)}</div>
  <div class="deck-meta">${escapeHtml(deck.source)} / ${formatBytes(deck.size)} / ${formatDate(deck.mtime)}</div>
</a></li>`
        )
        .join("\n")}</ul>`
    : `<p class="empty">再生できる PDF がありません。探索先は ${sourceList} です
       (<code>${escapeHtml(LOCAL_CONFIG_FILE)}</code> の <code>paths</code>、または <code>_site.yaml</code> の
       <code>local.paths</code> で変えられます)。</p>`;

  return renderPage({
    title: "ローカルモード | tadsan's slide deck",
    body: `<h1>ローカルモード<span class="badge">dev only</span></h1>
<p class="lede">手元の PDF を、公開前にそのまま再生します。探索先は ${sourceList}。
リポジトリの中にあるものはコミット済みのものを除いた分だけ並びます。このページはビルド出力には含まれません。</p>
${list}
<div class="actions" style="margin-top:2rem"><a href="/slides/">スライド一覧に戻る</a></div>`,
  });
}

function renderPlayerPage({ id, name, source, size, mtime, pages, pageSize }) {
  const pdfUrl = `${PDF_PREFIX}${id}.pdf`;
  const viewerUrl = `${VIEWER_PREFIX}?slide=${encodeURIComponent(pdfUrl)}`;
  // 画面が低いときにアスペクト比を崩さないよう、高さの上限を幅の上限に換算する
  // (SlideDetailPage.vue と同じ考え方)。
  const maxHeightVh = 78;
  const heightBoundWidthVh = ((maxHeightVh * pageSize.width) / pageSize.height).toFixed(2);
  const facts = [
    pages ? `${pages} ページ` : null,
    formatBytes(size),
    formatDate(mtime),
    `${pageSize.width}&times;${pageSize.height}`,
    escapeHtml(source),
  ].filter(Boolean);

  return renderPage({
    title: `${name} | ローカルモード`,
    body: `<div class="stage">
  <div class="stage-frame" style="width: min(100%, ${pageSize.width}px, ${heightBoundWidthVh}vh); aspect-ratio: ${pageSize.width} / ${pageSize.height};">
    <iframe id="js-viewer" src="${escapeHtml(viewerUrl)}" title="${escapeHtml(name)}" scrolling="no" allowfullscreen></iframe>
  </div>
</div>
<h1>${escapeHtml(name)}<span class="badge">dev only</span></h1>
<p class="lede">${facts.join(" / ")}</p>
<div class="actions">
  <button type="button" id="js-fullscreen">全画面で再生</button>
  <a href="${MOUNT}/">ローカルモードの一覧</a>
  <a href="/slides/">スライド一覧に戻る</a>
</div>
<script>${PLAYER_SCRIPT}</script>`,
  });
}

function renderMissingPage() {
  return renderPage({
    title: "見つかりません | ローカルモード",
    body: `<h1>見つかりません</h1>
<p class="lede">この PDF は探索先から消えたか、リポジトリにコミットされたようです。</p>
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

  // 配信できるのは一覧に出ている PDF だけ。ID から実体を引くので、
  // リクエストのパスがファイルシステムに触れることがない。
  async function serveLocalPdf(res, id) {
    const decks = await listLocalPdfs(root, await loadLocalPaths(root));
    const deck = decks.find((entry) => entry.id === id);
    if (!deck) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const fileStat = await stat(deck.path);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", fileStat.size);
    createReadStream(deck.path).pipe(res);
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
            await serveLocalPdf(res, rawPath.slice(PDF_PREFIX.length).replace(/\.pdf$/, ""));
            return;
          }

          // 設定はリクエストごとに読み直す。local.yaml を書き換えたら
          // dev サーバーを再起動せずに reload だけで反映される。
          const sources = await loadLocalPaths(root);
          const decks = await listLocalPdfs(root, sources);

          if (rawPath === `${MOUNT}/`) {
            sendHtml(res, renderIndexPage(decks, sources));
            return;
          }

          const id = rawPath.slice(MOUNT.length + 1).replace(/\/$/, "");
          const deck = decks.find((entry) => entry.id === id);
          if (!deck) {
            sendHtml(res, renderMissingPage(), 404);
            return;
          }
          const { pages, pageSize } = await inspectPdfCached(deck.path, await stat(deck.path));
          sendHtml(res, renderPlayerPage({ ...deck, pages, pageSize }));
        };

        handler().catch(next);
      });
    },
  };
}
