import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { extname, resolve } from "node:path";

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

export function detectContentType(filePath, fallback) {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES.get(ext) || fallback || "application/octet-stream";
}

export function serveStatic(options = {}) {
  const {
    root = ".",
    rewriteRequestPath,
    fallbackContentType,
    indexFile = null,
    maxAge = 0,
  } = options;

  const resolvedRoot = resolve(BASE_DIR, root);
  const cacheHeader = maxAge > 0 ? `public, max-age=${maxAge}` : "public, max-age=0, must-revalidate";

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
