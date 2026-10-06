import sharp from "sharp";
export const MAX_BYTES = 30000000;
export class InvalidPhoto extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function optimize(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new InvalidPhoto("photo_size");
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  const heic =
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /heic|heix|hevc|hevx|mif1/.test(bytes.toString("ascii", 8, 32));
  if (!jpeg && !png && !webp && !heic) throw new InvalidPhoto("photo_format");
  try {
    const image = sharp(bytes, {
      limitInputPixels: 60000000,
      failOn: "warning",
      sequentialRead: true,
    }).timeout({ seconds: 10 });
    const m = await image.metadata();
    if (!m.width || !m.height || m.width * m.height > 60000000)
      throw new InvalidPhoto("photo_pixels");
    if ((m.pages ?? 1) !== 1) throw new InvalidPhoto("photo_animated");
    if (!["jpeg", "png", "webp", "heif"].includes(m.format ?? ""))
      throw new InvalidPhoto("photo_format");
    // HEIF is a container, not a format allowance for AVIF/AV1.
    if (m.format === "heif" && m.compression !== "hevc")
      throw new InvalidPhoto("photo_format");
    // Re-encoding strips EXIF/GPS/ICC by default; autoOrient applies EXIF rotation first.
    const full = await image
      .clone()
      .autoOrient()
      .resize({
        width: 1920,
        height: 1920,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await image
      .clone()
      .autoOrient()
      .resize({
        width: 480,
        height: 480,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 76 })
      .toBuffer();
    return {
      image: full.data,
      thumb,
      width: full.info.width,
      height: full.info.height,
    };
  } catch (error) {
    if (error instanceof InvalidPhoto) throw error;
    throw new InvalidPhoto(heic ? "heic_unavailable" : "photo_decode");
  }
}
