import { describe, expect, it, vi } from "vitest";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ARCHIVE_PREFIX,
  archiveAssetUrlToVirtualPath,
  buildModAssetUrl,
  buildModAssetUrlFor3D,
  buildModAssetUrlForLive2D,
  decodeFileSrcUrl,
  getArchiveModId,
  isArchiveAssetUrl,
  isArchiveMod,
  joinPath,
  normalizePath,
  parseArchiveVirtualPath,
} from "$lib/utils/modAssetUrl";



describe("modAssetUrl utils", () => {
  it("normalizes paths and preserves protocol prefix", () => {
    expect(normalizePath("C:\\mods\\demo//asset\\idle.webp")).toBe("C:/mods/demo/asset/idle.webp");
    expect(normalizePath("tbuddy-archive://demo//asset\\idle.webp")).toBe("tbuddy-archive://demo/asset/idle.webp");
    expect(normalizePath("./mods//demo")).toBe("mods/demo");
    expect(normalizePath(undefined as unknown as string)).toBe("");
  });




  it("joins paths safely", () => {
    expect(joinPath("C:\\mods", "demo", "asset\\idle.webp")).toBe("C:/mods/demo/asset/idle.webp");
  });

  it("collapses duplicate slashes in live2d model paths", () => {
    expect(joinPath("tbuddy-archive://hiyori", "asset/live2d/", "/hiyori.model3.json")).toBe(
      "tbuddy-archive://hiyori/asset/live2d/hiyori.model3.json",
    );
  });


  it("parses archive virtual path", () => {
    expect(parseArchiveVirtualPath("tbuddy-archive://demo")).toEqual({
      modPath: "tbuddy-archive://demo",
      relativePath: "",
    });
    expect(parseArchiveVirtualPath("tbuddy-archive://demo/asset/idle.webp")).toEqual({
      modPath: "tbuddy-archive://demo",
      relativePath: "asset/idle.webp",
    });
    expect(parseArchiveVirtualPath("tbuddy-archive://")).toBeNull();
    expect(parseArchiveVirtualPath("tbuddy-archive:///bad")).toBeNull();
    expect(parseArchiveVirtualPath("http://example.com/asset.webp")).toBeNull();
  });



  it("detects archive mod and mod id", () => {
    expect(isArchiveMod("tbuddy-archive://demo")).toBe(true);
    expect(getArchiveModId("tbuddy-archive://demo")).toBe("demo");
  });

  it("converts archive asset url to virtual path", () => {
    const url = "http://tbuddy-asset.localhost/demo/asset/idle.webp";
    expect(archiveAssetUrlToVirtualPath(url)).toBe("tbuddy-archive://demo/asset/idle.webp");
    expect(archiveAssetUrlToVirtualPath("https://example.com/asset.webp")).toBeNull();
  });


  it("builds mod asset url for archive and folder mods", () => {
    const archiveUrl = buildModAssetUrl("tbuddy-archive://demo", "asset/idle.webp");
    expect(archiveUrl).toBe("http://tbuddy-asset.localhost/demo/asset/idle.webp");

    const folderUrl = buildModAssetUrl("C:\\mods\\demo", "asset/idle.webp");
    expect(folderUrl).toBe("C:/mods/demo/asset/idle.webp");
  });

  it("builds decoded urls for live2d and 3d", () => {
    const modPath = "C:\\mods\\demo";
    const rel = "asset/idle.webp";
    expect(buildModAssetUrlForLive2D(modPath, rel)).toBe("C:/mods/demo/asset/idle.webp");
    expect(buildModAssetUrlFor3D(modPath, rel)).toBe("C:/mods/demo/asset/idle.webp");
    expect(buildModAssetUrlForLive2D(`${ARCHIVE_PREFIX}demo`, rel)).toBe("http://tbuddy-asset.localhost/demo/asset/idle.webp");
  });

  it("detects archive asset urls and decodes file src", () => {
    expect(isArchiveAssetUrl("http://tbuddy-asset.localhost/demo/asset.webp")).toBe(true);
    expect(isArchiveAssetUrl("https://example.com/asset.webp")).toBe(false);
    expect(decodeFileSrcUrl("C%3A%2Fmods%2Fdemo")).toBe("C:/mods/demo");
  });

  it("detects archive url prefix via convertFileSrc", async () => {
    vi.resetModules();
    const core = await import("@tauri-apps/api/core");
    const spy = vi.spyOn(core, "convertFileSrc").mockReturnValueOnce("http://tbuddy-asset.localhost/__probe__");

    const mod = await import("$lib/utils/modAssetUrl");
    const url = mod.buildModAssetUrl("tbuddy-archive://demo", "asset/idle.webp");
    expect(url.startsWith("http://tbuddy-asset.localhost/")).toBe(true);

    spy.mockRestore();
  });

});


