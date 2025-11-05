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

function resolveDisplaySize(slide, pdfMeta) {
  const fallbackWidth = typeof slide.max_width === "number" ? slide.max_width : 1024;
  const fallbackHeight = typeof slide.max_height === "number" ? slide.max_height : 768;
  const metaWidth = pdfMeta?.size?.max_width;
  const metaHeight = pdfMeta?.size?.max_height;
  let width = typeof metaWidth === "number" ? metaWidth : fallbackWidth;
  let height = typeof metaHeight === "number" ? metaHeight : fallbackHeight;

  const minHeight = 1024;
  if (height < minHeight && height > 0) {
    const aspectRatio = width / height || (4 / 3);
    height = minHeight;
    width = Math.round(height * aspectRatio);
  }

  return { width, height };
}

export async function enrichSlide(slide, options = {}) {
  const { includePdfMeta = false } = options;
  let searchContent = "";
  let pdfMeta = null;
  try {
    pdfMeta = await loadPdfMeta(slide);
    searchContent = extractTextContent(pdfMeta);
  } catch (error) {
    console.warn(`メタデータ読み込み時の警告 (${slide.slug}):`, error);
  }

  const combinedContent = createCombinedContent({ searchContent, slide });
  const snippetSource = combinedContent || slide.title || "";
  const displaySize = resolveDisplaySize(slide, pdfMeta);
  const payload = {
    ...slide,
    searchContent,
    combinedContent,
    snippet: buildSnippet(snippetSource),
    displaySize,
  };

  if (includePdfMeta && pdfMeta) {
    payload.pdfMeta = pdfMeta;
  }

  return payload;
}

export async function generateSlidesData(options = {}) {
  const slides = await loadSlides();
  const enrichedSlides = [];

  for (const slide of slides) {
    enrichedSlides.push(await enrichSlide(slide, options));
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
