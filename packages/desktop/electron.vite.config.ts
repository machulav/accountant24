import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Standard electron-vite layout (src/main, src/preload, src/renderer), so the
// entry points and renderer root are the framework defaults. main + preload run
// in Node (deps externalized so the pi SDK and electron resolve from
// node_modules at runtime); renderer is the Vite/React/Tailwind app.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(import.meta.dirname, "src/main/index.ts"),
          // The agent-host utilityProcess entry, emitted as out/main/agent-host.js
          // next to the main bundle (see env.ts agentHostEntryPath).
          "agent-host": path.resolve(import.meta.dirname, "src/main/agent/host/index.ts"),
          // The ACP agent, emitted as out/main/acp.js. Not an Electron process at
          // all: resources/accountant24-acp runs it under ELECTRON_RUN_AS_NODE so
          // external ACP clients can drive the agent over stdio.
          acp: path.resolve(import.meta.dirname, "src/acp/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src/renderer") },
    },
  },
});
