<script setup>
defineOptions({ name: "SlideTextNode" });

import { computed } from "vue";

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
});

const children = computed(() => (Array.isArray(props.node?.children) ? props.node.children : []));
const textContent = computed(() => (typeof props.node?.content === "string" ? props.node.content : ""));
const href = computed(() => (typeof props.node?.href === "string" ? props.node.href : ""));
</script>

<template>
  <p v-if="node?.node === 'p'" class="slide-text-paragraph">
    <SlideTextNode v-for="(child, index) in children" :key="index" :node="child" />
  </p>

  <strong v-else-if="node?.node === 'bold'" class="slide-text-strong">
    <template v-if="children.length">
      <SlideTextNode v-for="(child, index) in children" :key="index" :node="child" />
    </template>
    <template v-else>{{ textContent }}</template>
  </strong>

  <span v-else-if="node?.node === 'text'">
    {{ textContent }}
  </span>

  <a v-else-if="node?.node === 'link'" :href="href" target="_blank" class="slide-text-link">
    <template v-if="children.length">
      <SlideTextNode v-for="(child, index) in children" :key="index" :node="child" />
    </template>
    <template v-else>{{ textContent || href }}</template>
  </a>

  <ul v-else-if="node?.node === 'ul'" class="slide-text-list">
    <SlideTextNode v-for="(child, index) in children" :key="index" :node="child" />
  </ul>

  <li v-else-if="node?.node === 'li'" class="slide-text-list-item">
    <template v-if="children.length">
      <SlideTextNode v-for="(child, index) in children" :key="index" :node="child" />
    </template>
    <template v-else>{{ textContent }}</template>
  </li>

  <br v-else-if="node?.node === 'br'" />

  <span v-else-if="node?.node === 'img'" class="slide-text-image-label">[image]</span>

  <template v-else>
    {{ textContent }}
  </template>
</template>
