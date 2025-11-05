<script setup>
import { computed } from "vue";
import { withBase } from "vitepress";

const props = defineProps({
  slide: {
    type: Object,
    required: true,
  },
});

const events = computed(() => props.slide.events ?? []);
const hasEvents = computed(() => events.value.some((event) => event?.name));
const tags = computed(() => props.slide.tags ?? []);
const detailUrl = computed(() => withBase(`/${props.slide.slug}/`));
</script>

<template>
  <article class="slide-card flex flex-col gap-3">
    <header>
      <p class="text-xs uppercase tracking-wide text-white/60">{{ slide.slug }}</p>
      <h3 class="font-semibold text-lg">
        <a :href="detailUrl" class="hover:text-sky-200">
          {{ slide.title }}
        </a>
      </h3>
      <p class="slide-meta-row">
        公開日:
        <time :datetime="slide.date">{{ slide.date }}</time>
      </p>
    </header>

    <section v-if="hasEvents" class="space-y-2 text-sm text-white/80">
      <p class="font-semibold text-white/90">Events</p>
      <ul class="space-y-1">
        <li v-for="event in events" :key="`${slide.slug}-${event?.name}`" class="flex items-start gap-2">
          <span aria-hidden="true">🎤</span>
          <div>
            <p>{{ event?.name }}</p>
            <p class="text-xs text-white/60" v-if="event?.presented_at">
              <time :datetime="event.presented_at">{{ event.presented_at }}</time>
            </p>
          </div>
        </li>
      </ul>
    </section>

    <p v-if="slide.snippet" class="text-sm text-white/70">
      {{ slide.snippet }}
    </p>

    <ul v-if="tags.length" class="mt-auto flex flex-wrap gap-2 text-xs">
      <li
        v-for="tag in tags"
        :key="`${slide.slug}-${tag}`"
        class="rounded-full bg-white/10 px-3 py-1 text-white/80"
      >
        #{{ tag }}
      </li>
    </ul>
  </article>
</template>
