import { defineConfig } from "vite";

export default defineConfig({
  // Use relative asset paths so the game can be deployed under a subdirectory
  // (e.g. https://example.com/RAI-Man_2025/) without changing code.
  base: "./",
  server: {
    port: 5173
  }
});
