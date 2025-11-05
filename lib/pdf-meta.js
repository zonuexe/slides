import yaml from "js-yaml";
import { readFile } from "fs/promises";

export async function loadPdfMeta(slide) {
  if (slide?.meta) {
    try {
      const metaFile = await readFile(slide.meta, "utf8");
      return yaml.load(metaFile);
    } catch (error) {
      console.error(`メタデータファイルの読み込みに失敗しました (${slide.meta}):`, error);
    }
  }

  return {
    size: {
      max_width: slide?.max_width || 1024,
      max_height: slide?.max_height || 768,
    },
    links: {},
  };
}
