import yaml from "js-yaml";
import { loadSlides } from "../../../lib/slides.js";
import { loadSiteConfig } from "../../../lib/site-config.js";
import { buildEventGroups } from "../../../lib/event-groups.js";

function buildHead({ group, description, count, site }) {
  const siteUrl = site.site?.url ?? "";
  const canonical = `${siteUrl}/slides/event/${group.id}/`;
  const imageUrl = `${siteUrl}/slides/zonuexe.png`;
  const twitterSite = site.twitter?.site ?? site.author?.twitter ?? "@tadsan";
  const twitterCreator = site.twitter?.creator ?? site.author?.twitter ?? "@tadsan";
  const ogTitle = `${group.name} での発表 ${count}件`;
  return [
    ["meta", { name: "description", content: description }],
    ["link", { rel: "canonical", href: canonical }],
    ["meta", { property: "og:title", content: ogTitle }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:url", content: canonical }],
    ["meta", { property: "og:image", content: imageUrl }],
    ["meta", { property: "og:site_name", content: site.ogp?.site_name ?? site.site?.name ?? "Slides" }],
    ["meta", { property: "og:locale", content: site.ogp?.locale ?? "ja_JP" }],
    ["meta", { name: "twitter:card", content: site.twitter?.card ?? "summary_large_image" }],
    ["meta", { name: "twitter:site", content: twitterSite }],
    ["meta", { name: "twitter:creator", content: twitterCreator }],
    ["meta", { name: "twitter:title", content: ogTitle }],
    ["meta", { name: "twitter:description", content: description }],
    ["meta", { name: "twitter:image", content: imageUrl }],
    ["link", { rel: "stylesheet", href: "/slides/css/index.css" }],
    ["script", { src: "https://kit.fontawesome.com/ca9a253b70.js", crossorigin: "anonymous" }],
  ];
}

function buildMarkdown({ group, description, count, site }) {
  const frontmatter = {
    title: `${group.name} | イベント`,
    description,
    layout: "page",
    sidebar: false,
    head: buildHead({ group, description, count, site }),
  };
  const frontmatterBlock = yaml.dump(frontmatter, { lineWidth: 1000 }).trim();
  return `---\n${frontmatterBlock}\n---\n\n<EventGroupPage groupId="${group.id}" />\n`;
}

export default {
  async paths() {
    const site = await loadSiteConfig();
    const slides = await loadSlides();
    // ページを作るのは「系列」として認識したグループのみ (単発イベントは個別スライドで十分)。
    const groups = buildEventGroups(slides).filter((group) => group.isSeries);

    return groups.map((group) => {
      const count = group.events.length;
      const description = `${group.name} での USAMI Kenta (tadsan) の登壇 ${count}件の一覧。`;
      return {
        params: { group: group.id },
        content: buildMarkdown({ group, description, count, site }),
      };
    });
  },
};
