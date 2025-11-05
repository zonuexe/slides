import { loadSlides } from "./slides.js";
import { loadPdfMeta } from "./pdf-meta.js";
import {
  extractTextContent,
  collectEventsText,
  collectRelatedArticlesText,
  buildSnippet,
} from "./search-content.js";

function normaliseTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => {
    if (typeof tag !== "string") return [];
    const value = tag.trim();
    return value ? [value] : [];
  });
}

function normaliseHashtags(tags) {
  if (!Array.isArray(tags)) return "";
  return tags
    .flatMap((tag) => {
      if (typeof tag !== "string") return [];
      const value = tag.trim();
      return value ? [`#${value}`] : [];
    })
    .join(" ");
}

function createCombinedContent({ searchContent, slide }) {
  const eventsText = collectEventsText(slide.events);
  const relatedArticlesText = collectRelatedArticlesText(slide.related_articles);
  const tagText = normaliseTags(slide.tags).join(" ");
  const hashtagText = normaliseHashtags(slide.hashtags);
  const downloadText = typeof slide.download === "string" ? slide.download : "";
  return [
    searchContent,
    eventsText,
    relatedArticlesText,
    tagText,
    hashtagText,
    downloadText,
  ]
    .filter(Boolean)
    .join(" ");
}

function pickClientEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const name = typeof event.name === "string" ? event.name : "";
    if (!name) return [];
    const presentedAt = typeof event.presented_at === "string" ? event.presented_at : "";
    const location = typeof event.location === "string" ? event.location : "";
    const place = typeof event.place === "string" ? event.place : "";
    return [
      {
        name,
        presented_at: presentedAt,
        location,
        place,
      },
    ];
  });
}

export async function enrichSlide(slide) {
  let searchContent = "";
  try {
    const meta = await loadPdfMeta(slide);
    searchContent = extractTextContent(meta);
  } catch (error) {
    console.warn(`メタデータ読み込み時の警告 (${slide.slug}):`, error);
  }

  const combinedContent = createCombinedContent({ searchContent, slide });
  const snippetSource = combinedContent || slide.title || "";

  return {
    ...slide,
    searchContent,
    combinedContent,
    snippet: buildSnippet(snippetSource),
  };
}

export async function generateSlidesData() {
  const slides = await loadSlides();
  const enrichedSlides = [];

  for (const slide of slides) {
    enrichedSlides.push(await enrichSlide(slide));
  }

  const slidesForClient = enrichedSlides.map((slide) => ({
    slug: slide.slug ?? "",
    title: slide.title ?? "",
    date: slide.date ?? "",
    content: slide.combinedContent ?? slide.searchContent ?? "",
    snippet: slide.snippet ?? "",
    events: pickClientEvents(slide.events),
    tags: normaliseTags(slide.tags),
  }));

  const slidesJson = JSON.stringify(slidesForClient).replace(/</g, "\\u003c");
  return { enrichedSlides, slidesJson };
}
