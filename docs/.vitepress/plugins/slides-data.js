import { resolve, dirname } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { generateSlidesData } from "../../../lib/slides-data.js";
import { loadSiteConfig } from "../../../lib/site-config.js";

const virtualModuleId = "virtual:slides-data";
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

export function slidesDataPlugin() {
  const root = resolve(process.cwd());
  const slidesDir = resolve(root, "slides");
  const pdfDir = resolve(root, "pdf");
  const siteYamlPath = resolve(root, "_site.yaml");
  const publicSlidesScript = resolve(root, "docs/public/index.js");

  async function writeSlidesDataScript(slides) {
    await mkdir(dirname(publicSlidesScript), { recursive: true });
    const script = `window.slidesData = ${JSON.stringify(slides).replace(/</g, "\\u003c")};\n`;
    await writeFile(publicSlidesScript, script, "utf8");
  }

  return {
    name: "slides-data-plugin",
    // ここで this.addWatchFile() は使わない。Vite 5 の dev は virtual module から
    // addWatchFile されたパスを import として解決しようとするため、slides/ のような
    // ディレクトリを渡すと "Failed to resolve import" で全ページが 500 になる。
    // ファイルを渡した場合はエラーにはならないが、モジュールグラフに載るだけで
    // 再読み込みの契機にはならなかった。dev の watcher を直に使って明示的に
    // virtual module を invalidate する。
    configureServer(server) {
      server.watcher.add([slidesDir, pdfDir, siteYamlPath]);

      const isSlidesInput = (file) => {
        const path = resolve(file);
        if (path === siteYamlPath) {
          return true;
        }
        const dir = dirname(path);
        return (dir === slidesDir || dir === pdfDir) && path.endsWith(".yaml");
      };

      const invalidate = (file) => {
        if (!isSlidesInput(file)) {
          return;
        }
        const mod = server.moduleGraph.getModuleById(resolvedVirtualModuleId);
        if (!mod) {
          return;
        }
        server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };

      for (const event of ["add", "change", "unlink"]) {
        server.watcher.on(event, invalidate);
      }
    },
    async load(id) {
      if (id !== resolvedVirtualModuleId) {
        return null;
      }

      const { enrichedSlides, slidesForClient } = await generateSlidesData({ includePdfMeta: true });
      await writeSlidesDataScript(slidesForClient);
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
