import { createReadStream } from "node:fs";
import { extname, resolve } from "node:path";
import { cp, rm, stat } from "node:fs/promises";

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
};

function contentTypeFor(filePath) {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] || "application/octet-stream";
}

export function pdfAssetsPlugin() {
  const root = resolve(process.cwd());
  const pdfSourceDir = resolve(root, "pdf");
  const pdfDistDir = resolve(root, "docs/.vitepress/dist/pdf");

  return {
    name: "pdf-assets-plugin",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (!path.startsWith("/pdf/") && !path.startsWith("/slides/pdf/")) {
          next();
          return;
        }

        const handler = async () => {
          const trimmed = path.replace(/^\/slides/, "");
          const relativePath = decodeURIComponent(trimmed.replace(/^\/+/, ""));
          const safePath = resolve(pdfSourceDir, relativePath.replace(/^pdf\//, ""));
          if (!safePath.startsWith(pdfSourceDir)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const fileStat = await stat(safePath);
          if (!fileStat.isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader("Content-Type", contentTypeFor(safePath));
          createReadStream(safePath).pipe(res);
        };

        handler().catch(next);
      });
    },
    async closeBundle() {
      await rm(pdfDistDir, { recursive: true, force: true });
      await cp(pdfSourceDir, pdfDistDir, { recursive: true });
    },
  };
}
