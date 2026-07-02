import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Three-target build: main + preload run in Node (deps externalized so the pi
// SDK and electron resolve from node_modules at runtime); renderer is the
// existing Vite/React/Tailwind app, unchanged.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: path.resolve(import.meta.dirname, "electron/main/index.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: path.resolve(import.meta.dirname, "electron/preload/index.ts") } },
    },
  },
  renderer: {
    root: import.meta.dirname,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    build: {
      rollupOptions: { input: { index: path.resolve(import.meta.dirname, "index.html") } },
    },
  },
});
