import { resolve } from "node:path";
import { defineConfig } from "vitepress";
import { loadSiteConfig } from "../../lib/site-config.js";
import { slidesDataPlugin } from "./plugins/slides-data.js";
import { pdfAssetsPlugin } from "./plugins/pdf-assets.js";

export default defineConfig(async () => {
  const site = await loadSiteConfig();
  const siteName = site.site?.name ?? "Slide Deck";
  const siteDescription = site.site?.description ?? "Talks and slide archives";

  return {
    lang: "ja-JP",
    base: "/slides/",
    title: siteName,
    description: siteDescription,
    cleanUrls: true,
    appearance: "dark",
    vite: {
      server: {
        fs: {
          allow: [process.cwd()],
        },
      },
      publicDir: resolve(process.cwd(), "docs/public"),
      plugins: [slidesDataPlugin(), pdfAssetsPlugin()],
    },
    themeConfig: {
      logo: "/zonuexe.png",
      nav: [
        { text: "Slides", link: "/" },
        { text: "About", link: site.author?.url ?? "https://twitter.com/tadsan" },
      ],
      socialLinks: site.author?.twitter
        ? [{ icon: "twitter", link: `https://twitter.com/${site.author.twitter.replace(/^@/, "")}` }]
        : [],
    },
  };
});
