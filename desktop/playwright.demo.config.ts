import { defineConfig } from "@playwright/test";

// Records the README / site demo: `npm run demo -w desktop`, then
// scripts/demo/to-gif.mjs turns the video into docs/demo.gif.
export default defineConfig({
  testDir: "scripts/demo",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 760 },
    colorScheme: "dark",
    video: { mode: "on", size: { width: 1280, height: 760 } },
  },
  outputDir: "scripts/demo/out",
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
