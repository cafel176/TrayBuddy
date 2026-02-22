import { describe, expect, it } from "vitest";
import { LRUCache } from "$lib/utils/LRUCache";

describe("LRUCache", () => {
  it("evicts least recently used after access reorder", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);

    cache.get("a");
    cache.set("c", 3);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("calls onEvict on eviction and clear", () => {
    const cache = new LRUCache<string, number>(2);
    const evicted: string[] = [];
    cache.setOnEvict((key) => evicted.push(String(key)));

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(evicted).toEqual(["a"]);

    cache.clear();
    expect(evicted).toEqual(["a", "b", "c"]);
    expect(cache.size).toBe(0);
  });

  it("refreshes existing keys on set", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 3);
    cache.set("c", 4);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });
});

