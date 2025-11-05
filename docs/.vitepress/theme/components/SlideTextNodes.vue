<script setup>
import SlideTextNode from "./SlideTextNode.vue";

const props = defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
});
</script>

<template>
  <div class="space-y-2 text-sm leading-relaxed">
    <SlideTextNode v-for="(node, index) in nodes" :key="index" :node="node" />
  </div>
</template>
