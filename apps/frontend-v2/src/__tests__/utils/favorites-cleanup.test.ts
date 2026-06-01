import { describe, it, expect } from "vitest";

/**
 * Test the favorites stale-id cleanup logic extracted from AttackList.tsx.
 *
 * Original code (AttackList.tsx ~L151-161):
 *   if (favorites.size > 0 && nodeList.length > 0) {
 *     const existingIds = new Set(nodeList.map(n => n.id));
 *     const stale = [...favorites].filter(id => !existingIds.has(id));
 *     if (stale.length > 0) {
 *       next = new Set(prev); stale.forEach(s => next.delete(s));
 *     }
 *   }
 */
function cleanStaleFavorites(favorites: Set<string>, existingIds: Set<string>): Set<string> {
  if (favorites.size === 0 || existingIds.size === 0) return favorites;
  const stale = [...favorites].filter((id) => !existingIds.has(id));
  if (stale.length === 0) return favorites;
  const next = new Set(favorites);
  for (const s of stale) next.delete(s);
  return next;
}

describe("favorites stale-id cleanup", () => {
  it("removes ids not present in existing nodes", () => {
    const favs = new Set(["a", "b", "c"]);
    const existing = new Set(["a", "c"]);
    const result = cleanStaleFavorites(favs, existing);
    expect(result).toEqual(new Set(["a", "c"]));
  });

  it("returns unchanged set when all favorites exist", () => {
    const favs = new Set(["a", "b"]);
    const existing = new Set(["a", "b", "c"]);
    const result = cleanStaleFavorites(favs, existing);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("returns unchanged set when favorites is empty", () => {
    const favs = new Set<string>();
    const existing = new Set(["a"]);
    const result = cleanStaleFavorites(favs, existing);
    expect(result.size).toBe(0);
  });

  it("returns unchanged set when existing is empty (no nodes loaded yet)", () => {
    const favs = new Set(["a", "b"]);
    const existing = new Set<string>();
    const result = cleanStaleFavorites(favs, existing);
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("removes all ids when none match existing", () => {
    const favs = new Set(["x", "y"]);
    const existing = new Set(["a", "b"]);
    const result = cleanStaleFavorites(favs, existing);
    expect(result.size).toBe(0);
  });
});
