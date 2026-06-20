<script setup>
import { computed, onMounted, watch, nextTick } from "vue";
import { withBase, useData } from "vitepress";
import { slides, siteConfig } from "virtual:slides-data";
import { buildEventNarratives } from "../../../../lib/events.js";
import SlideTextNodes from "./SlideTextNodes.vue";

const props = defineProps({
  slug: {
    type: String,
    default: null,
  },
});

const { params } = useData();
const activeSlug = computed(() => props.slug ?? params.value?.slug ?? "");
const slide = computed(() => slides.find((entry) => entry.slug === activeSlug.value));

const japaneseDate = computed(() => {
  if (!slide.value?.date) return slide.value?.date ?? "";
  const date = new Date(slide.value.date);
  if (Number.isNaN(date.valueOf())) {
    return slide.value.date;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
});

const slidePermalink = computed(() => (slide.value ? withBase(`/${slide.value.slug}/`) : withBase("/")));
const slidesIndexUrl = computed(() => withBase("/"));

const downloadUrl = computed(() => {
  if (!slide.value) return "#";
  return withBase(`/${slide.value.file}`);
});

const iframeUrl = computed(() => {
  if (!slide.value) return "";
  const embedBase = siteConfig.embed?.base_url ?? "";
  const slidePathBase = siteConfig.embed?.slide_path ?? `${siteConfig.site?.url ?? ""}/slides/pdf`;
  const fileName = slide.value.file.replace(/^pdf\//, "");
  return `${embedBase}/?slide=${encodeURIComponent(`${slidePathBase}/${fileName}`)}`;
});

const eventNarratives = computed(() => buildEventNarratives(slide.value?.events ?? []));
const relatedArticles = computed(() => slide.value?.related_articles ?? []);
const hashtags = computed(() => slide.value?.hashtags ?? []);

const textPages = computed(() => {
  if (!slide.value?.pdfMeta?.text) return [];
  return Object.entries(slide.value.pdfMeta.text)
    .map(([pageKey, nodes]) => ({
      page: pageKey.replace(/^p/, ""),
      order: Number(pageKey.replace(/\D/g, "")) || 0,
      nodes: Array.isArray(nodes) ? nodes : [],
    }))
    .sort((a, b) => a.order - b.order);
});

const linkPages = computed(() => {
  if (!slide.value?.pdfMeta?.links) return [];
  return Object.entries(slide.value.pdfMeta.links)
    .map(([pageKey, links]) => ({
      page: pageKey.replace(/^p/, ""),
      order: Number(pageKey.replace(/\D/g, "")) || 0,
      links: (links ?? []).map((link) => ({
        href: link.archive || link.url,
        title: link.title,
        url: link.url,
        archive: link.archive,
      })),
    }))
    .sort((a, b) => a.order - b.order);
});

const slideConfigPayload = computed(() => {
  if (!slide.value) return null;
  const width = slide.value.displaySize?.width ?? slide.value.max_width ?? 1024;
  const height = slide.value.displaySize?.height ?? slide.value.max_height ?? 768;
  return {
    maxWidth: width,
    maxHeight: height,
    download: slide.value.download ?? slide.value.file,
  };
});

// スライドの表示高さ上限（ビューポート高さ比）。これより画面が低いときは
// アスペクト比を保ったまま全体を縮小する。
const MAX_HEIGHT_VH = 66.67;

const pdfContainerStyle = computed(() => {
  if (!slide.value) return {};
  const width = slide.value.displaySize?.width ?? slide.value.max_width ?? 1024;
  const height = slide.value.displaySize?.height ?? slide.value.max_height ?? 768;
  // 高さの上限(MAX_HEIGHT_VH)を「幅の上限」に換算しておくことで、画面の高さが
  // 不足したときは max-height でクランプ(=比率が崩れる)させず、幅ごと縮小させる。
  const heightBoundWidthVh = (MAX_HEIGHT_VH * width / height).toFixed(2);
  return {
    width: `min(100%, ${width}px, ${heightBoundWidthVh}vh)`,
    aspectRatio: `${width} / ${height}`,
  };
});

function applySlideConfig() {
  if (typeof window === "undefined" || !slideConfigPayload.value) return;
  window.slideConfig = { ...slideConfigPayload.value };
  nextTick(() => {
    if (typeof window.initializeSlide === "function") {
      window.initializeSlide();
    }
  });
}

onMounted(() => {
  applySlideConfig();
});

watch(slideConfigPayload, () => {
  applySlideConfig();
});

function faviconUrl(url) {
  const encoded = encodeURIComponent(url);
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encoded}&size=32`;
}

function callGlobalFunction(fnName) {
  if (typeof window === "undefined") return;
  const fn = window[fnName];
  if (typeof fn === "function") {
    fn();
  }
}
</script>

<template>
  <section v-if="slide" class="slide-detail-page">
    <main class="container">
      <div id="pdf-container" :style="pdfContainerStyle" aria-label="Slide preview">
        <iframe v-if="iframeUrl" :src="iframeUrl" :title="slide.title" scrolling="no"></iframe>
      </div>
      <div class="pdf-controls">
        <button class="fullscreen-btn" @click.prevent="callGlobalFunction('toggleExpanded')">
          <i class="fa-solid fa-expand"></i>
        </button>
      </div>

      <div id="toast" class="toast"></div>

      <article class="slide-info h-entry">
        <button class="share-btn" @click.prevent="callGlobalFunction('shareSlide')">
          <i class="fa-solid fa-share-nodes"></i>
        </button>
        <button class="fullscreen-info-btn" @click.prevent="callGlobalFunction('toggleFullscreen')">
          <i class="fa-solid fa-display"></i>
        </button>
        <h1 class="slide-title">
          <a :href="slidePermalink" class="p-name u-url u-uid permalink-link">{{ slide.title }}</a>
        </h1>
        <p class="published-line">
          公開日: <time class="dt-published" :datetime="slide.date">{{ japaneseDate }}</time>
        </p>
        <p class="byline p-author h-card">
          by <a href="https://twitter.com/tadsan" class="p-name u-url">USAMI Kenta</a>
          <span class="p-nickname">@tadsan</span>
        </p>

        <div v-if="eventNarratives.length" class="event-info" v-html="eventNarratives.map((entry) => entry.html).join('')" />

        <div v-if="relatedArticles.length" class="related-articles">
          <ul>
            <li v-for="article in relatedArticles" :key="article.url">
              <img :src="faviconUrl(article.url)" width="16" height="16" alt="" />
              <a :href="article.url" class="u-url" target="_blank">{{ article.title }}</a>
              <template v-if="article.desc">
                <br />
                {{ article.desc }}
              </template>
            </li>
          </ul>
        </div>

        <div v-if="hashtags.length" class="hashtags">
          <a
            v-for="tag in hashtags"
            :key="tag"
            :href="`https://twitter.com/hashtag/${tag}`"
            target="_blank"
            class="hashtag p-category u-url"
          >
            #{{ tag }}
          </a>
        </div>

        <div class="download-section">
          <a :href="downloadUrl" :download="slide.download" class="download-btn">
            <i class="fa-solid fa-download"></i> Download PDF
          </a>
          <button class="download-image-btn" @click.prevent="callGlobalFunction('downloadCanvasAsImage')">
            <i class="fa-solid fa-image"></i> Save Current Page
          </button>
          <button class="copy-image-btn" @click.prevent="callGlobalFunction('copyCanvasToClipboard')">
            <i class="fa-solid fa-copy"></i> Copy Current Page
          </button>
        </div>

        <div class="slide-content e-content">
          <div class="content-panes">
            <div class="text-pane">
              <h3>スライドテキスト</h3>
              <template v-if="textPages.length">
                <div v-for="page in textPages" :key="`text-${page.page}`" class="page-content" :id="`page-${page.page}`">
                  <h4>Page {{ page.page }}</h4>
                  <SlideTextNodes :nodes="page.nodes" />
                </div>
              </template>
              <p v-else>テキスト情報がありません。</p>
            </div>

            <div class="links-pane">
              <h3>関連リンク</h3>
              <template v-if="linkPages.length">
                <div v-for="page in linkPages" :key="`link-${page.page}`" class="page-content" :id="`links-${page.page}`">
                  <h4>Page {{ page.page }}</h4>
                  <div class="page-links">
                    <ul>
                      <li v-for="link in page.links" :key="`${page.page}-${link.href}`">
                        <img :src="faviconUrl(link.href)" width="16" height="16" alt="" />
                        <a :href="link.href" target="_blank">{{ link.title || link.href }}</a>
                        <template v-if="link.archive">
                          <br />(original:
                          <a :href="link.url" target="_blank">{{ link.url }}</a>)
                        </template>
                      </li>
                    </ul>
                  </div>
                </div>
              </template>
              <p v-else>関連リンクがありません。</p>
            </div>
          </div>
        </div>

        <div class="back-link">
          <a :href="slidesIndexUrl" class="back-btn">
            <i class="fa-solid fa-arrow-left"></i>
            スライド一覧に戻る
          </a>
        </div>
      </article>
    </main>
    <hr />
    <address class="site-footer h-card">
      &copy; 2025 <span class="p-name">USAMI Kenta</span> (<a href="https://twitter.com/tadsan" class="u-url">@tadsan</a>)
    </address>
  </section>

  <section v-else class="slide-not-found">
    <p>指定されたスライドが見つかりませんでした。</p>
    <div class="back-link">
      <a :href="slidesIndexUrl" class="back-btn">
        <i class="fa-solid fa-arrow-left"></i>
        スライド一覧に戻る
      </a>
    </div>
  </section>
</template>
