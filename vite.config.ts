import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so it works under a GitHub Pages project subpath
  // (e.g. https://user.github.io/fruit-match/).
  base: "./",
  server: {
    host: true,
    port: 5173,
  },
});
