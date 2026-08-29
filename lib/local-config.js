import yaml from "js-yaml";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

// ローカルモードが PDF を探しに行くディレクトリの既定値。
export const DEFAULT_LOCAL_PATHS = ["~/Documents", "."];

// マシン固有のパスを書くための、コミットしない設定ファイル。
export const LOCAL_CONFIG_FILE = "local.yaml";

function expandPath(entry, root) {
  if (entry === "~") {
    return homedir();
  }
  if (entry.startsWith("~/")) {
    return resolve(homedir(), entry.slice(2));
  }
  if (isAbsolute(entry)) {
    return resolve(entry);
  }
  return resolve(root, entry);
}

async function readYaml(path) {
  try {
    return yaml.load(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    console.error(`${path} の読み込みに失敗しました:`, error);
    return null;
  }
}

function normalizeEntries(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
  return entries.length ? entries : null;
}

// 探索先ディレクトリを解決する。`local.yaml` の `paths` が `_site.yaml` の
// `local.paths` を上書きし、どちらも無ければ既定値。`~` はホーム、相対パスは
// リポジトリルート起点。同じ場所を指す指定 (`.` と絶対パスなど) は 1 つに畳む。
export async function loadLocalPaths(root) {
  const [site, override] = await Promise.all([
    readYaml(resolve(root, "_site.yaml")),
    readYaml(resolve(root, LOCAL_CONFIG_FILE)),
  ]);

  const entries =
    normalizeEntries(override?.paths) ?? normalizeEntries(site?.local?.paths) ?? DEFAULT_LOCAL_PATHS;

  const seen = new Set();
  const sources = [];
  for (const entry of entries) {
    const dir = expandPath(entry, root);
    if (seen.has(dir)) {
      continue;
    }
    seen.add(dir);
    sources.push({ entry, dir });
  }
  return sources;
}
