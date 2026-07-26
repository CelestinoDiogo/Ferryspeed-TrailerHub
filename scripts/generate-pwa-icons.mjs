import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const sourcePath = path.join(repoRoot, "public", "branding", "ferryspeed logo.png");
const outputDir = path.join(repoRoot, "public", "pwa");
const backgroundColor = "#041512";

const icons = [
  { file: "icon-192.png", size: 192, fitRatio: 0.78, maskable: false },
  { file: "icon-512.png", size: 512, fitRatio: 0.78, maskable: false },
  { file: "icon-maskable-192.png", size: 192, fitRatio: 0.72, maskable: true },
  { file: "icon-maskable-512.png", size: 512, fitRatio: 0.72, maskable: true },
  { file: "apple-touch-icon.png", size: 180, fitRatio: 0.8, maskable: false },
  { file: "favicon-32x32.png", size: 32, fitRatio: 0.84, maskable: false },
];

async function generateIcon({ file, size, fitRatio, maskable }) {
  const logoSize = Math.max(1, Math.round(size * fitRatio));

  const logoBuffer = await sharp(sourcePath)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: backgroundColor,
    },
  })
    .composite([{ input: logoBuffer, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDir, file));

  console.log(`Generated ${file}${maskable ? " (maskable)" : ""}`);
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  for (const icon of icons) {
    await generateIcon(icon);
  }

  console.log("PWA icon generation complete.");
}

main().catch((error) => {
  console.error("Failed to generate PWA icons:", error);
  process.exit(1);
});
