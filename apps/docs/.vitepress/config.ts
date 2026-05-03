import { defineConfig } from "vitepress";

export default defineConfig({
  title: "AgentAgora",
  description: "The open layer for agent identity, discovery, settlement, and audit.",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    siteTitle: "AgentAgora",
    nav: [
      { text: "Introduction", link: "/intro" },
      { text: "Quickstart", link: "/quickstart" },
      { text: "Protocol (AAP)", link: "/protocol" },
      { text: "GitHub", link: "https://github.com/agentagora/agentagora" },
    ],
    sidebar: [
      {
        text: "Get started",
        items: [
          { text: "Introduction", link: "/intro" },
          { text: "Quickstart", link: "/quickstart" },
        ],
      },
      {
        text: "Concepts",
        items: [
          { text: "AID", link: "/concepts/aid" },
          { text: "Manifest", link: "/concepts/manifest" },
          { text: "Audit chain", link: "/concepts/audit" },
          { text: "Disputes", link: "/concepts/disputes" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Protocol (AAP)", link: "/protocol" },
          { text: "SDK reference", link: "/sdk" },
          { text: "Cloud API reference", link: "/cloud-api" },
          { text: "Self-host", link: "/self-host" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/agentagora/agentagora" }],
    search: {
      provider: "local",
    },
    editLink: {
      pattern: "https://github.com/agentagora/agentagora/edit/main/apps/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the Apache-2.0 License.",
      copyright: "Copyright (c) 2026 AgentAgora contributors",
    },
  },
});
