import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // settings.ts reads localStorage; happy-dom provides it (and a DOM) cheaply.
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
  },
});
