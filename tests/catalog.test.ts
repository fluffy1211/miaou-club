import { test } from "node:test";
import assert from "node:assert/strict";
import { matching, normalize, parseFavorites } from "../src/lib/catalog.ts";
const breeds = [
  { id: "persian", name: "Persan", aliases: ["persian"], coat: "long" },
  {
    id: "maine-coon",
    name: "Maine Coon",
    aliases: ["main coon", "mainecoon"],
    coat: "long",
  },
  { id: "siamese", name: "Siamois", aliases: ["siamese"], coat: "short" },
];
test("search normalizes accents, case and repeated whitespace, and supports aliases", () => {
  assert.equal(normalize("  SIÂMOIS  "), "siamois");
  assert.deepEqual(
    matching(breeds, "  MAIN   coon ").map((b) => b.id),
    ["maine-coon"],
  );
  assert.deepEqual(
    matching(breeds, "PERSIAN").map((b) => b.id),
    ["persian"],
  );
  assert.deepEqual(matching(breeds, "introuvable"), []);
});
test("coat and search combine, with reversible alphabetical sorting", () => {
  assert.equal(matching(breeds, "persan", "short").length, 0);
  assert.deepEqual(
    matching(breeds, "", "long", "za").map((b) => b.id),
    ["persian", "maine-coon"],
  );
});
test("favorites tolerate corrupt storage, wrong shapes, duplicates and unknown IDs", () => {
  for (const raw of [null, "{", "{}", '"persian"'])
    assert.equal(parseFavorites(raw, ["persian"]).size, 0);
  assert.deepEqual(
    [...parseFavorites('["persian","persian","unknown",null,4]', ["persian"])],
    ["persian"],
  );
});
