#!/usr/bin/env node
'use strict';

// Run with Node.js and sharp available locally (or through NODE_PATH):
//   node scripts/generate-icons.cjs
// No fonts, network resources, or site/question data are used.
const fs = require('node:fs/promises');
const path = require('node:path');
let sharp;
try {
  sharp = require('sharp');
} catch (error) {
  console.error('Icon generation requires sharp. Install it locally or set NODE_PATH to an existing installation.');
  process.exit(1);
}

async function main() {
  const iconDir = path.resolve(__dirname, '..', 'icons');
  const source = await fs.readFile(path.join(iconDir, 'icon.svg'));
  const outputs = [
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ];
  for (const [name, size] of outputs) {
    const destination = path.join(iconDir, name);
    await sharp(source, { density: 288 })
      .resize(size, size)
      .flatten({ background: '#163a6b' })
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(destination);
    const metadata = await sharp(destination).metadata();
    if (metadata.width !== size || metadata.height !== size || metadata.hasAlpha) {
      throw new Error(`Unexpected icon dimensions or transparency: ${name}`);
    }
    console.log(`${name}: ${size}×${size}, opaque PNG`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
