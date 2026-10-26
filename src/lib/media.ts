import { getImage } from "astro:assets";
import type { ImageMetadata } from "astro";
const originals = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/figue-*.jpg",
  { eager: true },
);
const local = await Promise.all(
  Object.entries(originals).map(async ([path, { default: image }]) => {
    const optimized = await getImage({
      src: image,
      width: Math.min(1000, image.width),
      format: "webp",
      quality: 88,
    });
    return [
      path.split("/").pop()!,
      {
        src: optimized.src,
        width: Number(optimized.options.width),
        height: Number(optimized.options.height),
      },
    ] as const;
  }),
);
export const photos = Object.fromEntries(local);
