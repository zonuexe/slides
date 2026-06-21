<script setup>
import { computed } from "vue";
import { withBase } from "vitepress";
import { slides } from "virtual:slides-data";
import { buildEventGroups } from "../../../../lib/event-groups.js";

const allGroups = buildEventGroups(slides);
// 系列として認識したグループだけ一覧化する (件数の多い順 → 名前順は buildEventGroups 側で確定済み)。
const seriesGroups = computed(() => allGroups.filter((group) => group.isSeries));
const soloCount = computed(() => allGroups.filter((group) => !group.isSeries).length);

const slidesIndexUrl = computed(() => withBase("/"));

function groupUrl(id) {
  return withBase(`/event/${id}/`);
}

function talkCount(group) {
  return new Set(group.events.map((event) => event.slug)).size;
}
</script>

<template>
  <main class="container page-offset event-index">
    <h1 class="event-index-title">イベント一覧</h1>
    <p class="event-index-lead">登壇したイベントを系列ごとにまとめています。</p>

    <ul class="event-index-list">
      <li v-for="group in seriesGroups" :key="group.id" class="event-index-item">
        <a :href="groupUrl(group.id)" class="event-index-link">
          <span class="event-index-name">{{ group.name }}</span>
          <span class="event-index-count">{{ talkCount(group) }}件</span>
        </a>
      </li>
    </ul>

    <p v-if="soloCount" class="event-index-note">
      上記のほかに、系列化していない単発イベントが {{ soloCount }}件あります。
    </p>

    <div class="back-link event-back-link">
      <a :href="slidesIndexUrl" class="back-btn">
        <i class="fa-solid fa-arrow-left"></i>
        スライド一覧に戻る
      </a>
    </div>
  </main>
</template>
