import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const manifest = JSON.parse(
  await readFile("public/manifest.webmanifest", "utf8"),
);

test("manifest carries a description and installable icons", () => {
  assert.ok(manifest.description.length > 0);
  assert.ok(
    manifest.icons.some(
      (icon: { sizes: string; purpose?: string }) =>
        icon.sizes === "512x512" && icon.purpose === "maskable",
    ),
  );
});

test("manifest screenshots exist with the declared size and form factor", async () => {
  const shots: {
    src: string;
    sizes: string;
    type: string;
    form_factor: string;
  }[] = manifest.screenshots;
  for (const factor of ["narrow", "wide"])
    assert.ok(shots.filter((s) => s.form_factor === factor).length >= 2);
  // Chrome ignores a set with more than 8 screenshots per form factor.
  assert.ok(shots.length <= 8);
  for (const shot of shots) {
    const meta = await sharp(`public${shot.src}`).metadata();
    assert.equal(`${meta.width}x${meta.height}`, shot.sizes);
    assert.equal(`image/${meta.format}`, shot.type);
    const ratio = meta.width! / meta.height!;
    // Chrome requires a ratio below 2.3 and, for the same form factor, equal sizes.
    assert.ok(Math.max(ratio, 1 / ratio) < 2.3);
    assert.equal(shot.form_factor === "narrow", meta.height! > meta.width!);
  }
  for (const factor of ["narrow", "wide"])
    assert.equal(
      new Set(shots.filter((s) => s.form_factor === factor).map((s) => s.sizes))
        .size,
      1,
    );
});
