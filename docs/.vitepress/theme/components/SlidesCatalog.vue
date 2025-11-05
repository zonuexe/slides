<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { withBase } from "vitepress";
import Fuse from "fuse.js";
import SlideCard from "./SlideCard.vue";
import { slides, siteConfig } from "virtual:slides-data";

const allSlides = ref([...slides]);

const sortedSlides = computed(() => [...allSlides.value].sort((a, b) => new Date(b.date) - new Date(a.date)));

const fuse = computed(
  () =>
    new Fuse(sortedSlides.value, {
      keys: [
        { name: "title", weight: 0.4 },
        { name: "slug", weight: 0.3 },
        { name: "date", weight: 0.2 },
        { name: "combinedContent", weight: 0.1 },
      ],
      threshold: 0.3,
      ignoreLocation: true,
      includeScore: true,
    })
);

// URLのクエリパラメータから初期値を取得
const getInitialQuery = () => {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("q") || "";
};

const query = ref(getInitialQuery());

const filteredSlides = computed(() => {
  const term = query.value.trim();
  if (!term) {
    return sortedSlides.value;
  }
  return fuse.value.search(term).map((result) => result.item);
});

const totalCount = sortedSlides.value.length;
const resultCount = computed(() => filteredSlides.value.length);
const heroSubtitle = computed(() => siteConfig.site?.description ?? "Slide archive");

// クエリパラメータの変更を監視してURLを更新
watch(
  query,
  (newQuery) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const trimmedQuery = newQuery.trim();
    if (trimmedQuery) {
      url.searchParams.set("q", trimmedQuery);
    } else {
      url.searchParams.delete("q");
    }
    // 履歴を追加せずにURLを更新（ブラウザの戻る/進むボタンに影響しない）
    window.history.replaceState({}, "", url.toString());
  },
  { immediate: false }
);

onMounted(() => {
  if (Array.isArray(window.slidesData) && window.slidesData.length) {
    allSlides.value = window.slidesData;
  }
});
</script>

<template>
  <main class="container page-offset h-feed">
    <h1 class="site-title h-card p-author">
    </h1>

    <div class="search-toolbar">
      <label class="search-label">
        <span class="visually-hidden">スライドを検索</span>
        <input
          id="search-input"
          class="search-input"
          type="search"
          placeholder="タイトル・スラッグ・日付・本文で検索"
          autocomplete="off"
          v-model="query"
        />
      </label>
      <p id="search-result-count" class="search-result">全 {{ query.trim() ? resultCount : totalCount }}件</p>
    </div>

    <div class="slide-grid">
      <SlideCard v-for="slide in filteredSlides" :key="slide.slug" :slide="slide" :query="query" />
    </div>
  </main>
</template>
