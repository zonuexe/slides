<script setup>
import { computed } from "vue";
import { withBase } from "vitepress";
import { slides } from "virtual:slides-data";
import { buildEventGroups } from "../../../../lib/event-groups.js";
import SlideCard from "./SlideCard.vue";

const props = defineProps({
  groupId: {
    type: String,
    default: null,
  },
});

const groups = buildEventGroups(slides);
const group = computed(() => groups.find((entry) => entry.id === props.groupId) ?? null);

const slidesIndexUrl = computed(() => withBase("/"));
const eventsIndexUrl = computed(() => withBase("/event/"));

// グループ内の発表をスライド単位 (重複除去) にまとめ、日付の新しい順に並べる。
const groupSlides = computed(() => {
  if (!group.value) return [];
  const seen = new Set();
  const result = [];
  for (const entry of group.value.events) {
    if (!entry.slug || seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    const slide = slides.find((item) => item.slug === entry.slug);
    if (slide) result.push(slide);
  }
  return result.sort((a, b) => new Date(b.date) - new Date(a.date));
});

const talkCount = computed(() => groupSlides.value.length);
</script>

<template>
  <main v-if="group" class="container page-offset event-group-page h-feed">
    <nav class="event-group-breadcrumb">
      <a :href="eventsIndexUrl"><i class="fa-solid fa-layer-group"></i> イベント一覧</a>
    </nav>
    <h1 class="event-group-title">{{ group.name }}</h1>
    <p class="event-group-count">このイベントでの発表 {{ talkCount }}件</p>

    <div class="slide-grid">
      <SlideCard v-for="slide in groupSlides" :key="slide.slug" :slide="slide" />
    </div>

    <div class="back-link event-back-link">
      <a :href="slidesIndexUrl" class="back-btn">
        <i class="fa-solid fa-arrow-left"></i>
        スライド一覧に戻る
      </a>
    </div>
  </main>

  <main v-else class="container page-offset">
    <p>指定されたイベントが見つかりませんでした。</p>
    <div class="back-link event-back-link">
      <a :href="slidesIndexUrl" class="back-btn">
        <i class="fa-solid fa-arrow-left"></i>
        スライド一覧に戻る
      </a>
    </div>
  </main>
</template>
