import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.join(frontendRoot, "public/icons/favicon.png");
const outputDir = path.join(frontendRoot, "public/icons");
const background = { r: 28, g: 103, b: 255, alpha: 1 };

for (const size of [192, 512]) {
  await sharp(source)
    .resize(size, size, { fit: "contain" })
    .png()
    .toFile(path.join(outputDir, `pwa-icon-${size}-v2.png`));

  const safeSize = Math.round(size * 0.75);
  const inset = Math.floor((size - safeSize) / 2);
  const foreground = await sharp(source)
    .resize(safeSize, safeSize, { fit: "contain" })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: foreground, left: inset, top: inset }])
    .png()
    .toFile(path.join(outputDir, `pwa-maskable-${size}-v2.png`));
}

for (const size of [152, 167, 180]) {
  const foreground = await sharp(source)
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer();

  const icon = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([{ input: foreground, left: 0, top: 0 }])
    .png();

  await icon
    .clone()
    .toFile(path.join(outputDir, `apple-touch-icon-${size}-v2.png`));

  if (size === 180) {
    await icon
      .clone()
      .toFile(path.join(outputDir, "apple-touch-icon.png"));
    await icon
      .clone()
      .toFile(path.join(frontendRoot, "public/apple-touch-icon.png"));
  }
}
