import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheStore, createKvCacheStore } from "../src/cache";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemoryCacheStore", () => {
  it("round-trips a value and reports a miss as null", async () => {
    const cache = new MemoryCacheStore();
    expect(await cache.get("k")).toBeNull();
    await cache.put("k", "rows", 60);
    expect(await cache.get("k")).toBe("rows");
  });

  it("expires an entry once its ttl has passed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const cache = new MemoryCacheStore();
    await cache.put("k", "rows", 60);
    vi.spyOn(Date, "now").mockReturnValue(1_000 + 60_000);
    expect(await cache.get("k")).toBeNull();
  });

  it("evicts the oldest entry once capacity is exceeded", async () => {
    const cache = new MemoryCacheStore(2);
    await cache.put("a", "1", 600);
    await cache.put("b", "2", 600);
    await cache.put("c", "3", 600);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBe("2");
    expect(await cache.get("c")).toBe("3");
  });

  it("clear drops every entry", async () => {
    const cache = new MemoryCacheStore();
    await cache.put("k", "rows", 60);
    cache.clear();
    expect(await cache.get("k")).toBeNull();
  });
});

describe("KV cache adapter", () => {
  it("forwards reads and writes the ttl the service asked for", async () => {
    const get = vi.fn(async (key: string) => (key === "hit" ? "rows" : null));
    const put = vi.fn(async () => undefined);
    const store = createKvCacheStore({ get, put });

    expect(await store.get("hit")).toBe("rows");
    expect(await store.get("miss")).toBeNull();
    await store.put("k", "rows", 600);
    expect(put).toHaveBeenCalledWith("k", "rows", { expirationTtl: 600 });
  });
});
