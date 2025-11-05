import DefaultTheme from "vitepress/theme";
import SlidesCatalog from "./components/SlidesCatalog.vue";
import SlideDetailPage from "./components/SlideDetailPage.vue";
import "./styles/tailwind.css";
import "./styles/custom.css";

export default {
  ...DefaultTheme,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx);
    ctx.app.component("SlidesCatalog", SlidesCatalog);
    ctx.app.component("SlideDetailPage", SlideDetailPage);
  },
};
