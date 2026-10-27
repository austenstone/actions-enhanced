import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Actions Enhanced",
    description:
      "A faster way to scan workflow runs and find failed jobs, right inside GitHub.",
    version: "0.1.1",
    minimum_chrome_version: "120",
    permissions: ["storage"],
    icons: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    },
    homepage_url: "https://github.com/austenstone/actions-enhanced",
  },
});
