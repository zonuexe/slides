import { escapeHtml } from "./html.js";

function formatJapaneseDate(dateString) {
  if (typeof dateString !== "string" || !dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.valueOf())) {
    return dateString;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function buildEventRoleSegment(event) {
  const type = typeof event?.type === "string" ? event.type.trim() : "";
  const hasDuration = typeof event?.talk_duration === "number" && Number.isFinite(event.talk_duration);
  const durationMinutes = hasDuration ? `${event.talk_duration}分` : "";
  const durationSlot = hasDuration ? `${event.talk_duration}分枠` : "";

  let text = "";
  if (type && hasDuration) {
    text = `${type}(${durationMinutes})として`;
  } else if (hasDuration) {
    text = `${durationSlot}として`;
  } else if (type) {
    text = `${type}として`;
  }

  let html = "";
  if (type && hasDuration) {
    const typeHtml = `<span class="p-category">${escapeHtml(type)}</span>`;
    const durationHtml = `<span class="p-duration" data-duration="${escapeHtml(String(event.talk_duration))}">${escapeHtml(
      durationMinutes
    )}</span>`;
    html = `${typeHtml}(${durationHtml})として`;
  } else if (hasDuration) {
    const durationHtml = `<span class="p-duration" data-duration="${escapeHtml(String(event.talk_duration))}">${escapeHtml(
      durationSlot
    )}</span>`;
    html = `${durationHtml}として`;
  } else if (type) {
    html = `<span class="p-category">${escapeHtml(type)}</span>として`;
  }

  return { html, text };
}

export function buildEventNarrative(event) {
  if (!event || typeof event !== "object") return null;
  const name = typeof event.name === "string" ? event.name.trim() : "";
  if (!name) return null;

  const presentedAtRaw = typeof event.presented_at === "string" ? event.presented_at : "";
  const eventJapaneseDate = formatJapaneseDate(presentedAtRaw);
  const timeLabel = eventJapaneseDate || presentedAtRaw || "";
  const timeHtml = presentedAtRaw
    ? `<time class="dt-start" datetime="${escapeHtml(presentedAtRaw)}">${escapeHtml(timeLabel)}</time>`
    : "";
  const timeSegmentHtml = timeHtml ? `${timeHtml}に` : "";
  const timeSegmentText = timeLabel ? `${timeLabel}に` : "";

  const locationHtmlSegments = [];
  const locationTextSegments = [];
  if (typeof event.location === "string" && event.location.trim()) {
    locationHtmlSegments.push(`<span class="p-location">${escapeHtml(event.location.trim())}</span>`);
    locationTextSegments.push(event.location.trim());
  }
  if (typeof event.place === "string" && event.place.trim()) {
    locationHtmlSegments.push(`<span class="p-location">${escapeHtml(event.place.trim())}</span>`);
    locationTextSegments.push(event.place.trim());
  }
  const locationSegmentHtml = locationHtmlSegments.length ? `${locationHtmlSegments.join("の")}で` : "";
  const locationSegmentText = locationTextSegments.length ? `${locationTextSegments.join("の")}で` : "";

  const url = typeof event.url === "string" ? event.url : "";
  const nameHtml = url
    ? `<a href="${escapeHtml(url)}" class="p-name u-url" target="_blank">${escapeHtml(name)}</a>`
    : `<span class="p-name">${escapeHtml(name)}</span>`;
  const role = buildEventRoleSegment(event);

  const roleHtmlSegment = role.html ? `で${role.html}` : "";
  const roleTextSegment = role.text ? `で${role.text}` : "";

  const sentenceHtml = `${timeSegmentHtml}${locationSegmentHtml}開催された『${nameHtml}』${roleHtmlSegment}発表しました。`;
  const sentenceText = `${timeSegmentText}${locationSegmentText}開催された『${name}』${roleTextSegment}発表しました。`
    .replace(/\s+/g, " ")
    .trim();

  return {
    html: `<p class="event-entry h-event">${sentenceHtml}</p>`,
    text: sentenceText,
  };
}

export function buildEventNarratives(events) {
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    const narrative = buildEventNarrative(event);
    return narrative ? [narrative] : [];
  });
}
