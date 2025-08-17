import { load as loadYaml } from "js-yaml";
import { readFile } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadSlides() {
    try {
        const yamlPath = join(__dirname, "../slides.yaml");
        const yamlContent = await readFile(yamlPath, "utf8");
        const slidesData = loadYaml(yamlContent);

        // key-value形式のYAMLを配列に変換
        const slides = Object.entries(slidesData).map(([slug, data]) => ({
            slug,
            ...data
        }));

        return slides;
    } catch (error) {
        console.error("Error loading slides:", error);
        return [];
    }
}

export async function getSlideBySlug(slug) {
    try {
        const yamlPath = join(__dirname, "../slides.yaml");
        const yamlContent = await readFile(yamlPath, "utf8");
        const slidesData = loadYaml(yamlContent);

        // 指定されたslugのデータを取得
        if (slidesData[slug]) {
            return {
                slug,
                ...slidesData[slug]
            };
        }

        return undefined;
    } catch (error) {
        console.error("Error loading slide:", error);
        return undefined;
    }
}
