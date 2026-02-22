import { describe, expect, it } from "vitest";

type ImportCase = {
  name: string;
  loader: () => Promise<{ default: unknown }>;
};

const components: ImportCase[] = [
  { name: "EnvironmentDebugger", loader: () => import("../lib/components/EnvironmentDebugger.svelte") },
  { name: "InfoDebugger", loader: () => import("../lib/components/InfoDebugger.svelte") },
  { name: "LayoutDebugger", loader: () => import("../lib/components/LayoutDebugger.svelte") },
  { name: "MediaDebugger", loader: () => import("../lib/components/MediaDebugger.svelte") },
  { name: "ProcessDebugger", loader: () => import("../lib/components/ProcessDebugger.svelte") },
  { name: "ResourceManagerDebugger", loader: () => import("../lib/components/ResourceManagerDebugger.svelte") },
  { name: "Settings", loader: () => import("../lib/components/Settings.svelte") },
  { name: "StateDebugger", loader: () => import("../lib/components/StateDebugger.svelte") },
  { name: "SystemDebugger", loader: () => import("../lib/components/SystemDebugger.svelte") },
  { name: "TriggerDebugger", loader: () => import("../lib/components/TriggerDebugger.svelte") },
  { name: "BranchOptions", loader: () => import("../lib/bubble/BranchOptions.svelte") },
  { name: "Bubble", loader: () => import("../lib/bubble/Bubble.svelte") },
  { name: "BubbleManager", loader: () => import("../lib/bubble/BubbleManager.svelte") },
  { name: "TypewriterText", loader: () => import("../lib/bubble/TypewriterText.svelte") },
];



describe("components import", () => {
  it.each(components)("$name", async ({ loader }) => {
    const mod = await loader();
    expect(mod.default).toBeTruthy();
  });

  it("bubble index exports", async () => {
    const mod = await import("../lib/bubble/index");
    expect(mod.Bubble).toBeTruthy();
    expect(mod.BranchOptions).toBeTruthy();
    expect(mod.BubbleManager).toBeTruthy();
  });
});

