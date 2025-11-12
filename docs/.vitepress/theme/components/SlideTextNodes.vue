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
  <div class="slide-text-nodes">
    <SlideTextNode v-for="(node, index) in nodes" :key="index" :node="node" />
  </div>
</template>
