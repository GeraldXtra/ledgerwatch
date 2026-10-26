const path = require("path");
const fs = require("fs");

async function main() {
  const sharp = require("sharp");
  const resources = path.join(__dirname, "..", "resources");
  const svg = fs.readFileSync(path.join(resources, "icon.svg"));
  await sharp(svg, { density: 512 }).resize(1024, 1024).png().toFile(path.join(resources, "icon.png"));
  await sharp(svg, { density: 512 })
    .resize(1024, 1024)
    .flatten({ background: "#16191F" })
    .png()
    .toFile(path.join(resources, "icon-background.png"));
  const foreground = await sharp(svg, { density: 512 }).resize(640, 640).png().toBuffer();
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: foreground, gravity: "centre" }])
    .png()
    .toFile(path.join(resources, "icon-foreground.png"));
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: "#16191F" } })
    .composite([{ input: await sharp(svg, { density: 512 }).resize(512, 512).png().toBuffer(), gravity: "centre" }])
    .png()
    .toFile(path.join(resources, "splash.png"));
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: "#16191F" } })
    .composite([{ input: await sharp(svg, { density: 512 }).resize(512, 512).png().toBuffer(), gravity: "centre" }])
    .png()
    .toFile(path.join(resources, "splash-dark.png"));
  console.log("icons written to", resources);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
