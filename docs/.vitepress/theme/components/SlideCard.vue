<script setup>
import { computed } from "vue";
import { withBase } from "vitepress";

const props = defineProps({
  slide: {
    type: Object,
    required: true,
  },
  query: {
    type: String,
    default: "",
  },
});

const SNIPPET_LENGTH = 160;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSnippet(content, query) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (!query) {
    return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) {
    return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
  }
  const start = Math.max(0, index - Math.floor(SNIPPET_LENGTH / 4));
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightSnippet(snippet, query) {
  if (!query) {
    return escapeHtml(snippet);
  }
  const pattern = new RegExp(`(${escapeRegExp(query)})`, "gi");
  const parts = snippet.split(pattern);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        return `<mark>${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

const events = computed(() => props.slide.events ?? []);
const hasEvents = computed(() => events.value.some((event) => event?.name));
const tags = computed(() => props.slide.tags ?? []);
const detailUrl = computed(() => withBase(`/${props.slide.slug}/`));

const trimmedQuery = computed(() => props.query.trim());
const snippetText = computed(() => {
  const content = props.slide.combinedContent || props.slide.snippet || "";
  return buildSnippet(content, trimmedQuery.value);
});

const snippetHtml = computed(() => {
  if (!snippetText.value) return "";
  return trimmedQuery.value
    ? highlightSnippet(snippetText.value, trimmedQuery.value)
    : escapeHtml(snippetText.value);
});

const showSnippet = computed(() => {
  return !!snippetText.value;
});
</script>

<template>
  <article class="slide-card h-entry">
    <h3>
      <a class="slide-link p-name u-url" :href="detailUrl">{{ slide.title }}</a>
    </h3>
    <p class="slide-card-meta">{{ slide.slug }}</p>
    <p>
      <i class="fa-solid fa-calendar-day"></i> 公開日:
      <time class="dt-published" :datetime="slide.date">{{ slide.date }}</time>
    </p>
    <div v-if="hasEvents" class="slide-card-events">
      <p
        v-for="event in events"
        :key="`${slide.slug}-${event?.name}`"
        class="slide-card-event h-event"
      >
        <i class="fa-solid fa-microphone-lines" aria-hidden="true"></i>
        <span class="p-name">{{ event?.name }}</span>
        <template v-if="event?.presented_at">
          <time class="dt-start visually-hidden" :datetime="event.presented_at">{{ event.presented_at }}</time>
        </template>
        <template v-if="event?.location || event?.place">
          <span class="p-location visually-hidden">{{ [event?.location, event?.place].filter(Boolean).join(" / ") }}</span>
        </template>
      </p>
    </div>
    <ul v-if="tags.length" class="slide-card-tags">
      <li v-for="tag in tags" :key="`${slide.slug}-${tag}`" class="p-category">
        <i class="fa-solid fa-tag" aria-hidden="true"></i>
        {{ tag }}
      </li>
    </ul>
    <p
      v-if="showSnippet"
      class="slide-card-snippet p-summary"
      :class="{ 'visually-hidden': !trimmedQuery }"
      v-html="snippetHtml"
    ></p>
    <span class="p-author h-card visually-hidden">
      <a href="https://twitter.com/tadsan" class="p-name u-url">USAMI Kenta</a>
    </span>
  </article>
</template>
