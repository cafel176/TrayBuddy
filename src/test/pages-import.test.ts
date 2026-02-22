import { describe, expect, it } from "vitest";

type ImportCase = {
  name: string;
  loader: () => Promise<{ default: unknown }>;
};

const pages: ImportCase[] = [
  { name: "root", loader: () => import("../routes/+page.svelte") },
  { name: "about", loader: () => import("../routes/about/+page.svelte") },
  { name: "animation", loader: () => import("../routes/animation/+page.svelte") },
  { name: "live2d", loader: () => import("../routes/live2d/+page.svelte") },
  { name: "mods", loader: () => import("../routes/mods/+page.svelte") },
  { name: "memo", loader: () => import("../routes/memo/+page.svelte") },
  { name: "pngremix", loader: () => import("../routes/pngremix/+page.svelte") },
  { name: "reminder", loader: () => import("../routes/reminder/+page.svelte") },
  { name: "reminder_alert", loader: () => import("../routes/reminder_alert/+page.svelte") },
  { name: "settings", loader: () => import("../routes/settings/+page.svelte") },
  { name: "threed", loader: () => import("../routes/threed/+page.svelte") },
];

describe("pages import", () => {
  it.each(pages)("$name", async ({ loader }) => {
    const mod = await loader();
    expect(mod.default).toBeTruthy();
  });
});
