export const SNIPPET_LENGTH = 160;

export function collectTextFromBlock(block, collector) {
  if (!block || typeof block !== "object") return;
  if (typeof block.text === "string") {
    collector.push(block.text);
  }
  if (Array.isArray(block.items)) {
    block.items.forEach((item) => {
      if (typeof item === "string") collector.push(item);
    });
  }
}

export function extractTextContent(meta) {
  if (!meta || typeof meta !== "object") return "";
  const collected = [];
  const textSections = meta.text;
  if (textSections && typeof textSections === "object") {
    const pages = Array.isArray(textSections) ? textSections : Object.values(textSections);
    pages.forEach((blocks) => {
      if (Array.isArray(blocks)) {
        blocks.forEach((block) => collectTextFromBlock(block, collected));
      }
    });
  }
  const links = meta.links;
  if (links && typeof links === "object") {
    Object.values(links).forEach((items) => {
      if (Array.isArray(items)) {
        items.forEach((link) => {
          if (link && typeof link.title === "string") {
            collected.push(link.title);
          }
          if (link && typeof link.url === "string") {
            collected.push(link.url);
          }
        });
      }
    });
  }
  return collected
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSnippet(text) {
  if (!text) return "";
  const normalised = text.replace(/\s+/g, " ").trim();
  if (normalised.length <= SNIPPET_LENGTH) {
    return normalised;
  }
  return `${normalised.slice(0, SNIPPET_LENGTH)}…`;
}

function toSearchFragment(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return "";
}

export function collectEventsText(events) {
  if (!Array.isArray(events)) return "";
  return events
    .flatMap((event) => {
      if (!event || typeof event !== "object") return [];
      const fragments = [
        event?.name,
        event?.type,
        event?.location,
        event?.place,
        event?.presented_at,
        event?.url,
        event?.talk_duration,
      ].flatMap((value) => {
        const fragment = toSearchFragment(value);
        return fragment ? [fragment] : [];
      });
      const combined = fragments.join(" ").trim();
      return combined ? [combined] : [];
    })
    .join(" ");
}

export function collectRelatedArticlesText(relatedArticles) {
  if (!Array.isArray(relatedArticles)) return "";
  return relatedArticles
    .flatMap((article) => {
      if (!article || typeof article !== "object") return [];
      const fragments = [article?.title, article?.desc, article?.url].flatMap((value) => {
        const fragment = toSearchFragment(value);
        return fragment ? [fragment] : [];
      });
      const combined = fragments.join(" ").trim();
      return combined ? [combined] : [];
    })
    .join(" ");
}
