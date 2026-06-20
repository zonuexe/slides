import { resolve, dirname } from "node:path";
import { writeFile, mkdir, readdir } from "node:fs/promises";
import { generateSlidesData } from "../../../lib/slides-data.js";
import { loadSiteConfig } from "../../../lib/site-config.js";

const virtualModuleId = "virtual:slides-data";
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

export function slidesDataPlugin() {
  const root = resolve(process.cwd());
  const slidesDir = resolve(root, "slides");
  const siteYamlPath = resolve(root, "_site.yaml");
  const publicSlidesScript = resolve(root, "docs/public/index.js");

  async function writeSlidesDataScript(slides) {
    await mkdir(dirname(publicSlidesScript), { recursive: true });
    const script = `window.slidesData = ${JSON.stringify(slides).replace(/</g, "\\u003c")};\n`;
    await writeFile(publicSlidesScript, script, "utf8");
  }

  return {
    name: "slides-data-plugin",
    async load(id) {
      if (id !== resolvedVirtualModuleId) {
        return null;
      }

      this.addWatchFile(slidesDir);
      try {
        const slideFiles = await readdir(slidesDir);
        for (const name of slideFiles) {
          if (name.endsWith(".yaml")) {
            this.addWatchFile(resolve(slidesDir, name));
          }
        }
      } catch {
        // slides/ が無い場合は generateSlidesData 側で空配列にフォールバックする
      }
      this.addWatchFile(siteYamlPath);

      const { enrichedSlides, slidesForClient } = await generateSlidesData({ includePdfMeta: true });
      await writeSlidesDataScript(slidesForClient);
      for (const slide of enrichedSlides) {
        if (slide.meta) {
          this.addWatchFile(resolve(root, slide.meta));
        }
      }
      const siteConfig = await loadSiteConfig();
      return `export const slides = ${JSON.stringify(
        enrichedSlides
      )};\nexport const siteConfig = ${JSON.stringify(siteConfig)};\nexport default { slides, siteConfig };`;
    },
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      return null;
    },
  };
}
