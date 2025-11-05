export default {
  content: [
    "./docs/**/*.md",
    "./docs/.vitepress/theme/**/*.{vue,js,ts}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#38bdf8",
        },
      },
    },
  },
  plugins: [],
};
