import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { cp, rm, stat } from "node:fs/promises";

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
          res.setHeader("Content-Type", "application/pdf");
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
