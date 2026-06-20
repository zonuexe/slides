<script setup>
import { computed } from "vue";

const props = defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
});

// 見出しレベル 1..3 を h2..h4 に対応させる (ページ内 h1 と衝突させない)
function headingTag(level) {
  const n = Math.min(4, Math.max(2, Number(level || 2) + 1));
  return `h${n}`;
}

const blocks = computed(() => (Array.isArray(props.nodes) ? props.nodes : []));
</script>

<template>
  <div class="slide-text-nodes">
    <template v-for="(block, index) in blocks" :key="index">
      <component
        :is="headingTag(block.level)"
        v-if="block?.kind === 'heading'"
        class="slide-text-heading"
        :data-level="block.level"
      >
        {{ block.text }}
      </component>

      <ul v-else-if="block?.kind === 'list'" class="slide-text-list">
        <li v-for="(item, i) in block.items" :key="i" class="slide-text-list-item">
          {{ item }}
        </li>
      </ul>

      <p v-else-if="block?.kind === 'para'" class="slide-text-paragraph">
        {{ block.text }}
      </p>
    </template>
  </div>
</template>
