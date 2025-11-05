import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { generateSlidesData } from "../../../lib/slides-data.js";
import { loadSiteConfig } from "../../../lib/site-config.js";

export function oembedPlugin() {
  const root = resolve(process.cwd());
  const distDir = resolve(root, "docs/.vitepress/dist");

  return {
    name: "oembed-plugin",
    async closeBundle() {
      const config = await loadSiteConfig();
      const { enrichedSlides } = await generateSlidesData({ includePdfMeta: false });

      for (const slide of enrichedSlides) {
        const slug = slide.slug;
        if (!slug) continue;

        const embedUrl = `${config.embed.base_url}/?slide=${encodeURIComponent(`${config.embed.slide_path}/${slide.file}`)}`;
        const width = slide.displaySize?.width ?? slide.max_width ?? 1024;
        const height = slide.displaySize?.height ?? slide.max_height ?? 768;

        const oembedData = {
          type: config.oembed.type,
          version: config.oembed.version,
          title: slide.title || "",
          url: embedUrl,
          author_name: config.author.name,
          author_url: config.author.url,
          provider_name: config.oembed.provider_name,
          provider_url: config.oembed.provider_url,
          width: width,
          height: height,
          html: `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" scrolling="no" title="${slide.title || ""}"></iframe>`,
        };

        // oEmbed JSONファイルを生成
        const jsonDir = resolve(distDir, slug);
        await mkdir(jsonDir, { recursive: true });
        const jsonPath = resolve(jsonDir, "oembed.json");
        await writeFile(jsonPath, JSON.stringify(oembedData, null, 2), "utf8");

        // oEmbed XMLファイルを生成
        const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<oembed>
  <type>${oembedData.type}</type>
  <version>${oembedData.version}</version>
  <title>${escapeXml(oembedData.title)}</title>
  <url>${escapeXml(oembedData.url)}</url>
  <author_name>${escapeXml(oembedData.author_name)}</author_name>
  <author_url>${escapeXml(oembedData.author_url)}</author_url>
  <provider_name>${escapeXml(oembedData.provider_name)}</provider_name>
  <provider_url>${escapeXml(oembedData.provider_url)}</provider_url>
  <width>${oembedData.width}</width>
  <height>${oembedData.height}</height>
  <html><![CDATA[${oembedData.html}]]></html>
</oembed>`;

        const xmlPath = resolve(jsonDir, "oembed.xml");
        await writeFile(xmlPath, xml, "utf8");
      }
    },
  };
}

function escapeXml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

