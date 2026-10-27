import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Actions Enhanced",
    description:
      "A faster way to scan workflow runs and find failed jobs, right inside GitHub.",
    version: "0.1.0",
    minimum_chrome_version: "120",
    permissions: ["storage"],
  },
});
