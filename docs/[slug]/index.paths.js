import yaml from "js-yaml";
import { generateSlidesData } from "../../lib/slides-data.js";
import { loadSiteConfig } from "../../lib/site-config.js";
import { buildEventNarratives } from "../../lib/events.js";

function escapeDescription(text) {
  return text.replace(/\s+/g, " ").trim();
}

function buildHead({ slide, description, site }) {
  const siteUrl = site.site?.url ?? "";
  const canonical = `${siteUrl}/slides/${slide.slug}/`;
  const imagePath = slide.image ? `/slides/${slide.image}` : "/slides/zonuexe.png";
  const imageUrl = `${siteUrl}${imagePath}`;
  const pdfUrl = `${siteUrl}/slides/${slide.file}`;
  const twitterSite = site.twitter?.site ?? site.author?.twitter ?? "@tadsan";
  const twitterCreator = site.twitter?.creator ?? site.author?.twitter ?? "@tadsan";
  return [
    ["meta", { name: "description", content: description }],
    ["link", { rel: "canonical", href: canonical }],
    ["link", { rel: "alternate", type: "application/pdf", href: pdfUrl }],
    ["meta", { property: "og:title", content: slide.title }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:type", content: site.ogp?.type ?? "website" }],
    ["meta", { property: "og:url", content: canonical }],
    ["meta", { property: "og:image", content: imageUrl }],
    ["meta", { property: "og:site_name", content: site.ogp?.site_name ?? site.site?.name ?? "Slides" }],
    ["meta", { property: "og:locale", content: site.ogp?.locale ?? "ja_JP" }],
    ["meta", { name: "twitter:card", content: site.twitter?.card ?? "summary_large_image" }],
    ["meta", { name: "twitter:site", content: twitterSite }],
    ["meta", { name: "twitter:creator", content: twitterCreator }],
    ["meta", { name: "twitter:title", content: slide.title }],
    ["meta", { name: "twitter:description", content: description }],
    ["meta", { name: "twitter:image", content: imageUrl }],
    ["link", { rel: "stylesheet", href: "/slides/css/slide.css" }],
    ["script", { src: "https://kit.fontawesome.com/ca9a253b70.js", crossorigin: "anonymous" }],
    ["script", { src: "/slides/js/slide-functions.js", defer: true }],
  ];
}

function buildMarkdown({ slide, description, site }) {
  const frontmatter = {
    title: slide.title,
    description,
    layout: "page",
    sidebar: false,
    head: buildHead({ slide, description, site }),
  };
  const frontmatterBlock = yaml.dump(frontmatter, { lineWidth: 1000 }).trim();
  return `---\n${frontmatterBlock}\n---\n\n<SlideDetailPage slug="${slide.slug}" />\n`;
}

export default {
  async paths() {
    const site = await loadSiteConfig();
    const { enrichedSlides } = await generateSlidesData({ includePdfMeta: true });

    return enrichedSlides.map((slide) => {
      const eventNarratives = buildEventNarratives(slide.events ?? []);
      const descriptionSource = eventNarratives.length
        ? eventNarratives.map((entry) => entry.text).join(" ")
        : slide.description ?? site.site?.description ?? slide.title;
      const description = escapeDescription(descriptionSource);

      return {
        params: { slug: slide.slug },
        content: buildMarkdown({ slide, description, site }),
      };
    });
  },
};
