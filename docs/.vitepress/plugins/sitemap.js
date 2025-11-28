import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { generateSlidesData } from "../../../lib/slides-data.js";
import { loadSiteConfig } from "../../../lib/site-config.js";

function normaliseBaseUrl(siteUrl) {
  if (!siteUrl) return "";
  return siteUrl.replace(/\/+$/, "");
}

function buildLoc(base, path) {
  const trimmedBase = normaliseBaseUrl(base);
  const trimmedPath = path.replace(/^\/*/, "");
  return `${trimmedBase}/${trimmedPath}`;
}

function isoDate(dateText) {
  if (!dateText) return null;
  const date = new Date(dateText);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString();
}

async function buildXml() {
  const site = await loadSiteConfig();
  const siteUrl = normaliseBaseUrl(site.site?.url ?? "");
  const basePath = "/slides/";
  const baseLoc = buildLoc(siteUrl, basePath);

  const { enrichedSlides } = await generateSlidesData({ includePdfMeta: false });

  const entries = [
    { loc: `${baseLoc}`, lastmod: new Date().toISOString() },
    ...enrichedSlides.map((slide) => ({
      loc: `${baseLoc}${slide.slug}/`,
      lastmod: isoDate(slide.date),
    })),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map((entry) => {
    const lastmod = entry.lastmod ? `    <lastmod>${entry.lastmod}</lastmod>\n` : "";
    return `  <url>
    <loc>${entry.loc}</loc>
${lastmod}  </url>`;
  })
  .join("\n")}
</urlset>
`;
}

export function sitemapPlugin() {
  const root = resolve(process.cwd());
  const distDir = resolve(root, "docs/.vitepress/dist");
  const baseDir = resolve(distDir, "slides");

  return {
    name: "sitemap-plugin",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (path !== "/slides/sitemap.xml") {
          next();
          return;
        }
        try {
          const xml = await buildXml();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          res.end(xml);
        } catch (error) {
          console.error("Failed to build sitemap:", error);
          res.statusCode = 500;
          res.end("Failed to build sitemap");
        }
      });
    },
    async closeBundle() {
      const xml = await buildXml();
      await mkdir(distDir, { recursive: true });
      await mkdir(baseDir, { recursive: true });
      await writeFile(resolve(distDir, "sitemap.xml"), xml, "utf8");
      await writeFile(resolve(baseDir, "sitemap.xml"), xml, "utf8");
    },
  };
}
