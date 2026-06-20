import { load as loadYaml } from "js-yaml";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SLIDES_DIR = join(__dirname, "../slides");

// 1スライド = slides/<slug>.yaml。file / meta / image は slug (または stem) から導出する。
// 物理ファイル名が slug と異なる場合 (旧 kn 接頭辞など) だけ stem: で上書きする。
// file / meta / image を明示すれば従来どおりの完全指定も可能。
function deriveSlide(slug, data) {
    const { stem, ...rest } = data ?? {};
    const base = stem || slug;
    return {
        slug,
        file: `pdf/${base}.pdf`,
        meta: `pdf/${base}.yaml`,
        image: `pdf/${base}.png`,
        ...rest,
    };
}

export async function loadSlides() {
    try {
        const entries = await readdir(SLIDES_DIR);
        const yamlFiles = entries.filter((name) => name.endsWith(".yaml"));

        const slides = await Promise.all(
            yamlFiles.map(async (name) => {
                const slug = name.replace(/\.yaml$/, "");
                const content = await readFile(join(SLIDES_DIR, name), "utf8");
                return deriveSlide(slug, loadYaml(content));
            })
        );

        // 表示順は描画側 (SlidesCatalog) が日付降順でソートするので、ここでは glob 順のままでよい。
        return slides;
    } catch (error) {
        console.error("Error loading slides:", error);
        return [];
    }
}

export async function getSlideBySlug(slug) {
    try {
        const content = await readFile(join(SLIDES_DIR, `${slug}.yaml`), "utf8");
        return deriveSlide(slug, loadYaml(content));
    } catch (error) {
        if (error?.code !== "ENOENT") {
            console.error("Error loading slide:", error);
        }
        return undefined;
    }
}
