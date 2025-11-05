<script setup>
import { computed, ref } from "vue";
import Fuse from "fuse.js";
import SlideCard from "./SlideCard.vue";
import { slides, siteConfig } from "virtual:slides-data";

const sortedSlides = [...slides].sort((a, b) => new Date(b.date) - new Date(a.date));
const fuse = new Fuse(sortedSlides, {
  keys: [
    { name: "title", weight: 0.4 },
    { name: "slug", weight: 0.3 },
    { name: "date", weight: 0.2 },
    { name: "combinedContent", weight: 0.1 },
  ],
  threshold: 0.35,
  includeScore: true,
});

const query = ref("");
const filteredSlides = computed(() => {
  const term = query.value.trim();
  if (!term) {
    return sortedSlides;
  }
  return fuse.search(term).map((result) => result.item);
});

const totalCount = sortedSlides.length;
const resultCount = computed(() => filteredSlides.value.length);
const heroSubtitle = computed(() => siteConfig.site?.description ?? "Slide archive");
</script>

<template>
  <section class="space-y-10">
    <header class="text-center space-y-3">
      <p class="text-sm uppercase tracking-widest text-slate-300">tadsan</p>
      <h1 class="text-3xl font-bold text-white">
        {{ siteConfig.site?.name ?? "Slide Deck" }}
      </h1>
      <p class="text-white/80">{{ heroSubtitle }}</p>
    </header>

    <div class="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <label class="text-sm font-medium text-white/60" for="slide-search">スライド検索</label>
      <input
        id="slide-search"
        v-model="query"
        placeholder="タイトル・スラッグ・日付・本文で検索"
        class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-lg text-white outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-500/50"
        type="search"
      />
      <p class="text-sm text-white/70">
        {{ resultCount }} / {{ totalCount }} 件
      </p>
    </div>

    <div class="slide-grid two-columns">
      <SlideCard v-for="slide in filteredSlides" :key="slide.slug" :slide="slide" />
    </div>
  </section>
</template>
