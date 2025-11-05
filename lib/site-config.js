import yaml from "js-yaml";
import { readFile } from "fs/promises";

const DEFAULT_CONFIG = {
  site: {
    name: "tadsan's slide deck",
    url: "https://zonuexe.github.io",
    description: "tadsan's slide deck",
  },
  author: {
    name: "tadsan",
    url: "https://twitter.com/tadsan",
    twitter: "@tadsan",
  },
  oembed: {
    provider_name: "tadsan's slide deck",
    provider_url: "https://zonuexe.github.io/slides/",
    type: "rich",
    version: "1.0",
  },
  ogp: {
    type: "website",
    locale: "ja_JP",
    site_name: "tadsan's slide deck",
  },
  twitter: {
    card: "summary_large_image",
    site: "@tadsan",
    creator: "@tadsan",
  },
  embed: {
    base_url: "https://zonuexe.github.io/slide-pdf.js",
    slide_path: "https://zonuexe.github.io/slides/pdf",
  },
};

export async function loadSiteConfig(configPath = "./_site.yaml") {
  try {
    const configFile = await readFile(configPath, "utf8");
    const loaded = yaml.load(configFile);
    return { ...DEFAULT_CONFIG, ...loaded };
  } catch (error) {
    console.error("サイト設定の読み込みに失敗しました:", error);
    return DEFAULT_CONFIG;
  }
}
