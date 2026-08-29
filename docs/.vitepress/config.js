import { resolve } from "node:path";
import { defineConfig } from "vitepress";
import { loadSiteConfig } from "../../lib/site-config.js";
import { slidesDataPlugin } from "./plugins/slides-data.js";
import { pdfAssetsPlugin } from "./plugins/pdf-assets.js";
import { localModePlugin } from "./plugins/local-mode.js";
import { oembedPlugin } from "./plugins/oembed.js";
import { sitemapPlugin } from "./plugins/sitemap.js";

export default defineConfig(async () => {
  const site = await loadSiteConfig();
  const siteName = site.site?.name ?? "Slide Deck";
  const siteDescription = site.site?.description ?? "Talks and slide archives";
  const siteUrl = site.site?.url ?? "https://zonuexe.github.io";
  const slidesOrigin = `${siteUrl.replace(/\/$/, "")}/slides`;
  const imageUrl = `${slidesOrigin}/zonuexe.png`;

  return {
    lang: "ja-JP",
    base: "/slides/",
    title: siteName,
    description: siteDescription,
    head: [
      ["meta", { name: "description", content: siteDescription }],
      ["link", { rel: "icon", type: "image/png", href: imageUrl }],
      ["meta", { property: "og:title", content: siteName }],
      ["meta", { property: "og:description", content: siteDescription }],
      ["meta", { property: "og:type", content: site.ogp?.type ?? "website" }],
      ["meta", { property: "og:url", content: `${slidesOrigin}/` }],
      ["meta", { property: "og:image", content: imageUrl }],
      ["meta", { property: "og:site_name", content: site.ogp?.site_name ?? siteName }],
      ["meta", { property: "og:locale", content: site.ogp?.locale ?? "ja_JP" }],
      ["meta", { name: "twitter:card", content: site.twitter?.card ?? "summary_large_image" }],
      ["meta", { name: "twitter:site", content: site.twitter?.site ?? site.author?.twitter ?? "@tadsan" }],
      ["meta", { name: "twitter:creator", content: site.twitter?.creator ?? site.author?.twitter ?? "@tadsan" }],
      ["meta", { name: "twitter:title", content: siteName }],
      ["meta", { name: "twitter:description", content: siteDescription }],
      ["meta", { name: "twitter:image", content: imageUrl }],
      ["link", { rel: "author", href: "https://www.hatena.ne.jp/zonu_exe/" }],
      ["script", { src: "https://kit.fontawesome.com/ca9a253b70.js", crossorigin: "anonymous" }],
    ],
    cleanUrls: true,
    appearance: "dark",
    transformHead({ pageData }) {
      if (pageData.relativePath === "index.md") {
        return [["link", { rel: "canonical", href: `${slidesOrigin}/` }]];
      }

      return [];
    },
    vite: {
      server: {
        fs: {
          allow: [process.cwd()],
        },
      },
      publicDir: resolve(process.cwd(), "docs/public"),
      plugins: [slidesDataPlugin(), pdfAssetsPlugin(), localModePlugin(), oembedPlugin(), sitemapPlugin()],
      build: {
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (id.includes("node_modules")) {
                if (id.includes("fuse.js")) {
                  return "vendor-fuse";
                }
                if (id.includes("js-yaml")) {
                  return "vendor-yaml";
                }

                return "vendor";
              }
            },
          },
        },
      },
    },
    themeConfig: {
      logo: "/zonuexe.png",
      nav: [
        { text: "Slides", link: "/" },
        { text: "Events", link: "/event/" },
        { text: "About", link: site.author?.url ?? "https://twitter.com/tadsan" },
      ],
      socialLinks: site.author?.twitter
        ? [{ icon: "twitter", link: `https://twitter.com/${site.author.twitter.replace(/^@/, "")}` }]
        : [],
    },
  };
});
