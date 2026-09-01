#!/usr/bin/env node
/**
 * Generate the app icons from one SVG source.
 *
 * The manifest shipped with no `icons` array at all, which is why an installed
 * PWA showed a generic tile. Rather than commit a pile of PNGs nobody can
 * regenerate, the mark is defined once here and every size is derived — change
 * a colour or the geometry and re-run.
 *
 * The mark: two plates on a bar, which at small sizes reads as ∞. Dumbbell and
 * "forever" in one shape, which is the product's whole claim. Checked down to
 * 32px, where it still resolves.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '../public');
const iconDir = join(publicDir, 'icons');

/** Dark-theme tokens: --ff-color-ground and --ff-color-accent. */
const BG = '#0A1119';
const FG = '#FF7A33';

/**
 * @param {{ size?: number, inset?: number, rounded?: boolean, bg?: string }} opts
 *
 * `inset` is the fraction of the canvas left empty around the art:
 *  - 0.14 for the normal icon, so it fills its tile as iOS and desktop expect.
 *  - 0.26 for maskable, because Android crops to a circle inscribed in roughly
 *    80% of the tile and may crop harder — the art has to survive losing its
 *    corners entirely.
 */
function markSvg({ size = 512, inset = 0.14, rounded = true, bg = BG } = {}) {
  const c = size / 2;
  const art = size * (1 - inset * 2);
  const r = art * 0.215;
  const ring = art * 0.085;
  const gap = art * 0.115;
  const barH = art * 0.1;
  const barW = gap * 2 + r * 0.7;
  const radius = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>
  <rect x="${c - barW / 2}" y="${c - barH / 2}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${FG}"/>
  <circle cx="${c - gap - r * 0.52}" cy="${c}" r="${r - ring / 2}" fill="none" stroke="${FG}" stroke-width="${ring}"/>
  <circle cx="${c + gap + r * 0.52}" cy="${c}" r="${r - ring / 2}" fill="none" stroke="${FG}" stroke-width="${ring}"/>
</svg>`;
}

mkdirSync(iconDir, { recursive: true });

// SVG sources, committed so the mark is inspectable and re-derivable.
writeFileSync(join(iconDir, 'icon.svg'), markSvg({ size: 512, inset: 0.14 }));
writeFileSync(join(iconDir, 'icon-maskable.svg'), markSvg({ size: 512, inset: 0.26, rounded: false }));
writeFileSync(join(publicDir, 'favicon.svg'), markSvg({ size: 64, inset: 0.1 }));

/** @type {{ file: string, size: number, svg: string }[]} */
const targets = [
  { file: 'icons/icon-192.png', size: 192, svg: markSvg({ size: 512, inset: 0.14 }) },
  { file: 'icons/icon-512.png', size: 512, svg: markSvg({ size: 512, inset: 0.14 }) },
  // Maskable is square and edge-to-edge: the platform supplies the shape, and a
  // rounded source inside a circular mask shows the tile's corners as notches.
  { file: 'icons/icon-maskable-512.png', size: 512, svg: markSvg({ size: 512, inset: 0.26, rounded: false }) },
  // iOS does not mask and does not read SVG, so this one has to be a square PNG
  // with its own background baked in.
  { file: 'icons/apple-touch-icon.png', size: 180, svg: markSvg({ size: 512, inset: 0.16, rounded: false }) },
  { file: 'favicon-32.png', size: 32, svg: markSvg({ size: 64, inset: 0.1 }) },
];

const written = await Promise.all(
  targets.map(async ({ file, size, svg }) => {
    const out = join(publicDir, file);
    mkdirSync(dirname(out), { recursive: true });
    const buffer = await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(out, buffer);
    return `${file} ${size}x${size} ${(buffer.length / 1024).toFixed(1)}KB`;
  }),
);

/**
 * The share card. 1200x630 is the size every crawler assumes; anything else gets
 * letterboxed or cropped by whichever service renders it. Text is set large
 * because most impressions are a small card in a feed, not a full-width preview.
 */
function ogSvg() {
  const w = 1200;
  const h = 630;
  const mark = 168;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <g transform="translate(96 ${(h - mark) / 2}) scale(${mark / 512})">
    ${markSvg({ size: 512, inset: 0.06, rounded: false, bg: 'none' }).replace(/<\/?svg[^>]*>/g, '')}
  </g>
  <text x="${96 + mark + 56}" y="${h / 2 - 26}" fill="#E4ECF4"
        font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-size="66" font-weight="700">Free Forever Fitness</text>
  <text x="${96 + mark + 56}" y="${h / 2 + 44}" fill="#8FA3B8"
        font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-size="34" font-weight="500">Lift and food logging. No account, no subscription.</text>
  <rect x="${96 + mark + 58}" y="${h / 2 + 78}" width="150" height="8" rx="4" fill="${FG}"/>
</svg>`;
}

writeFileSync(
  join(publicDir, 'og-image.png'),
  await sharp(Buffer.from(ogSvg())).png({ compressionLevel: 9 }).toBuffer(),
);

console.log('build-icons:');
for (const line of written) console.log(`  ${line}`);
console.log('  og-image.png 1200x630');
