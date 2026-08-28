#!/usr/bin/env node
/**
 * tokens/tokens.json -> dist/tokens.css, dist/tokens.ts, dist/theme.css
 *
 * Three artefacts from one source so they cannot drift (ADR-0021). Nothing in dist/
 * is hand-editable; every file it writes carries a generated-file banner.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');

const T = JSON.parse(readFileSync(join(root, 'tokens', 'tokens.json'), 'utf8'));
const P = T.meta.prefix;
const BASE = T.meta.rootFontSizePx;

const BANNER = (src) =>
  `/* GENERATED FILE - DO NOT EDIT.\n` +
  ` * Source: packages/design-system/tokens/tokens.json\n` +
  ` * Regenerate: pnpm --filter @freeforever/design-system build:tokens\n` +
  ` * Emitted as ${src}. Editing this file by hand will be overwritten and will\n` +
  ` * silently break the WCAG contrast suite that guards the palette (ADR-0013).\n */\n`;

const rem = (px) => {
  const v = px / BASE;
  return `${String(Number(v.toFixed(6)))}rem`;
};

/**
 * A CSS custom-property name is a <dashed-ident>, and an unescaped `.` is not a valid
 * ident character - it terminates the ident and turns the whole declaration into a
 * syntax error. Token keys like `kg-2.5` are the right thing in JSON and in the TS
 * export, so the dot is translated here, at the single point where a key becomes a
 * CSS name.
 *
 * `_` rather than an escaped `\.`: an escaped dot is valid, but anyone later
 * hand-writing `var(--ff-plate-kg-2.5-fill)` without the backslash gets silence
 * instead of an error. A token whose correct spelling is easy to typo invisibly is a
 * bad token. Nobody should be hand-writing these anyway - see `plateVar` in
 * dist/tokens.ts.
 */
const cssIdent = (key) => {
  const safe = String(key).replace(/\./g, '_');
  if (!/^[A-Za-z0-9_-]+$/.test(safe)) {
    throw new Error(
      `Token key ${JSON.stringify(key)} cannot become a CSS ident. ` +
        `Custom-property names may contain only [A-Za-z0-9_-].`,
    );
  }
  return safe;
};

/** `--color-*: initial` is Tailwind v4 namespace-reset syntax, not a property name. */
const NAMESPACE_RESET = /^--[A-Za-z0-9_-]*\*$/;
const VALID_CUSTOM_PROPERTY = /^--[A-Za-z0-9_-]+$/;

/**
 * Fail the build rather than emit a stylesheet the CSS parser will reject.
 *
 * This is the guard the plate bug got past: five plate colours were emitted with a
 * dot in the name, every consumer's `var()` silently resolved to nothing, and the
 * only signal was a `[WARNING] Expected ":"` buried in `vite build` output. Both
 * declarations and references are checked - a reference to an unparseable name is
 * just as dead as the declaration.
 */
function assertValidCustomProperties(css, file) {
  const declared = [...css.matchAll(/^\s*(--[^\s:]+)\s*:/gm)].map((m) => m[1]);
  const referenced = [...css.matchAll(/var\(\s*(--[^\s,)]+)/g)].map((m) => m[1]);
  const bad = [...new Set([...declared, ...referenced])].filter(
    (name) => !VALID_CUSTOM_PROPERTY.test(name) && !NAMESPACE_RESET.test(name),
  );
  if (bad.length > 0) {
    throw new Error(
      `${file}: ${bad.length} invalid CSS custom-property name(s): ${bad.join(', ')}. ` +
        `Names must match ${VALID_CUSTOM_PROPERTY}.`,
    );
  }
}

const colorEntries = Object.entries(T.color);

/* ------------------------------------------------------------------ tokens.css */

const colorBlock = (theme, indent) =>
  colorEntries.map(([name, v]) => `${indent}--${P}-color-${name}: ${v[theme]};`).join('\n');

const staticBlock = () => {
  const L = [];
  L.push(`  /* Space scale - the only spacing values that exist. */`);
  for (const [k, v] of Object.entries(T.space)) L.push(`  --${P}-space-${k}: ${rem(v.px)};`);
  L.push(``, `  /* Radius */`);
  for (const [k, v] of Object.entries(T.radius)) L.push(`  --${P}-radius-${k}: ${v.px}px;`);
  L.push(``, `  /* Border widths - public vocabulary; feature teams need a hairline. */`);
  for (const [k, v] of Object.entries(T.border)) L.push(`  --${P}-border-${k}: ${v.px}px;`);
  L.push(``, `  /* Hit targets - px on purpose: a thumb does not scale with the root font size. */`);
  for (const [k, v] of Object.entries(T.hit)) L.push(`  --${P}-hit-${k}: ${v.px}px;`);
  L.push(``, `  /* Motion */`);
  for (const [k, v] of Object.entries(T.motion.duration)) L.push(`  --${P}-duration-${k}: ${v.ms}ms;`);
  for (const [k, v] of Object.entries(T.motion.easing)) L.push(`  --${P}-ease-${k}: ${v.value};`);
  L.push(``, `  /* Type scale */`);
  for (const [k, v] of Object.entries(T.type)) {
    L.push(`  --${P}-text-${k}: ${rem(v.px)};`);
    L.push(`  --${P}-leading-${k}: ${v.lineHeight};`);
    L.push(`  --${P}-weight-${k}: ${v.weight};`);
    L.push(`  --${P}-tracking-${k}: ${v.tracking};`);
  }
  L.push(``, `  /* Font families (self-hosted, subset, variable - ADR-0014) */`);
  for (const [k, v] of Object.entries(T.font)) L.push(`  --${P}-font-${k}: ${v.value};`);
  L.push(``, `  /* IWF calibrated plate colours - identical in both themes by design (ADR-0013). */`);
  for (const [k, v] of Object.entries(T.plate.iwf)) {
    L.push(`  --${P}-plate-${cssIdent(k)}-fill: ${v.fill};`);
    L.push(`  --${P}-plate-${cssIdent(k)}-label: ${v.label};`);
  }
  return L.join('\n');
};

const tokensCss = `${BANNER('dist/tokens.css')}
/*
 * Three-state theme pattern. The complete palette is defined on bare :root, so a
 * document that stamps nothing still renders correctly. The two dark blocks only
 * redefine colour; every other token is theme-independent and lives on :root alone.
 *
 *   (no attribute) + light OS  -> bare :root
 *   (no attribute) + dark OS   -> :root:not([data-theme="light"]) inside the media query
 *   [data-theme="dark"]        -> explicit dark, wins over a light OS preference
 *   [data-theme="light"]       -> explicit light, excluded from the media query above
 *
 * ADR-0013 is dark-first as a design direction: the app shell stamps
 * data-theme="dark" as its default rather than relying on the OS.
 */
:root {
${colorBlock('light', '  ')}

${staticBlock()}

  /* Every number in this product is read at a glance and compared to the last one. */
  font-variant-numeric: tabular-nums;
  font-family: var(--${P}-font-sans);
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${colorBlock('dark', '    ')}
  }
}

:root[data-theme="dark"] {
${colorBlock('dark', '    ')}
}
`;

/* ------------------------------------------------------------------- tokens.ts */

const q = (s) => JSON.stringify(s);
const obj = (entries, indent = '  ') =>
  entries.map(([k, v]) => `${indent}${q(k)}: ${v},`).join('\n');

const tokensTs = `${BANNER('dist/tokens.ts')}
/**
 * Typed token exports for the places CSS custom properties cannot reach:
 * canvas chart rendering, native status/navigation bar colours, and any code
 * that must resolve a literal colour for the *active* theme at runtime.
 *
 * Prefer the CSS custom properties (dist/tokens.css) everywhere else - they
 * follow the theme automatically. Importing a literal here and hard-coding it
 * into a stylesheet defeats the point.
 */

export type ThemeName = 'dark' | 'light';

export const themes = ['dark', 'light'] as const satisfies readonly ThemeName[];

export type ColorName =
${colorEntries.map(([k]) => `  | ${q(k)}`).join('\n')};

/** Which contrast rule a colour is held to. See test/contrast.test.ts. */
export type ColorRole = 'surface' | 'text' | 'ui' | 'on-fill' | 'decorative';

export const colorRoles = {
${obj(colorEntries.map(([k, v]) => [k, q(v.role)]))}
} as const satisfies Record<ColorName, ColorRole>;

/** Literal hex values per theme. */
export const color = {
  dark: {
${obj(colorEntries.map(([k, v]) => [k, q(v.dark)]), '    ')}
  },
  light: {
${obj(colorEntries.map(([k, v]) => [k, q(v.light)]), '    ')}
  },
} as const satisfies Record<ThemeName, Record<ColorName, string>>;

/** \`var()\` references. Use these in inline styles rather than literals. */
export const colorVar = {
${obj(colorEntries.map(([k]) => [k, q(`var(--${P}-color-${k})`)]))}
} as const satisfies Record<ColorName, string>;

/** Resolve a literal colour for a theme - for canvas, meta[theme-color], native bars. */
export function colorFor(theme: ThemeName, name: ColorName): string {
  return color[theme][name];
}

export const space = {
${obj(Object.entries(T.space).map(([k, v]) => [k, String(v.px)]))}
} as const;

export const radius = {
${obj(Object.entries(T.radius).map(([k, v]) => [k, String(v.px)]))}
} as const;

/** Border widths in CSS px. Public: use these rather than a literal or a var() fallback. */
export const border = {
${obj(Object.entries(T.border).map(([k, v]) => [k, String(v.px)]))}
} as const;

/** Minimum tap sizes in CSS px. \`min\` is the floor; \`midSet\` is anything tapped between sets. */
export const hit = {
${obj(Object.entries(T.hit).map(([k, v]) => [k, String(v.px)]))}
} as const;

export const duration = {
${obj(Object.entries(T.motion.duration).map(([k, v]) => [k, String(v.ms)]))}
} as const;

export const easing = {
${obj(Object.entries(T.motion.easing).map(([k, v]) => [k, q(v.value)]))}
} as const;

export interface TypeStep {
  readonly px: number;
  readonly rem: string;
  readonly lineHeight: number;
  readonly weight: number;
  readonly tracking: string;
}

export const type = {
${Object.entries(T.type)
  .map(
    ([k, v]) =>
      `  ${q(k)}: { px: ${v.px}, rem: ${q(rem(v.px))}, lineHeight: ${v.lineHeight}, weight: ${v.weight}, tracking: ${q(v.tracking)} },`,
  )
  .join('\n')}
} as const satisfies Record<string, TypeStep>;

export const font = {
${obj(Object.entries(T.font).map(([k, v]) => [k, q(v.value)]))}
} as const;

export interface Plate {
  readonly kg: number;
  readonly fill: string;
  readonly label: string;
  readonly name: string;
}

/**
 * IWF calibrated plate colours - the same in both themes, because the plate on the
 * floor is the same colour in a dark gym (ADR-0013). Always draw a plate with a
 * \`line-strong\` outline: white5 and the light grey do not separate from a light
 * surface on their own. The mass is always printed on the slab; colour alone never
 * identifies a plate.
 */
export const plates = {
${Object.entries(T.plate.iwf)
  .map(([k, v]) => `  ${q(k)}: { kg: ${v.kg}, fill: ${q(v.fill)}, label: ${q(v.label)}, name: ${q(v.name)} },`)
  .join('\n')}
} as const satisfies Record<string, Plate>;

/**
 * \`var()\` references for the plate colours, keyed exactly like \`plates\`.
 *
 * Use these instead of writing the custom-property name by hand. The CSS name is not
 * the same string as the key - \`kg-2.5\` becomes \`--ff-plate-kg-2_5-fill\`, because a
 * dot is not valid in a CSS ident - and a mistyped custom property fails silently
 * rather than loudly. Importing the reference removes the chance to get it wrong.
 */
export const plateVar = {
${Object.entries(T.plate.iwf)
  .map(
    ([k]) =>
      `  ${q(k)}: { fill: ${q(`var(--${P}-plate-${cssIdent(k)}-fill)`)}, label: ${q(`var(--${P}-plate-${cssIdent(k)}-label)`)} },`,
  )
  .join('\n')}
} as const satisfies Record<keyof typeof plates, { readonly fill: string; readonly label: string }>;

export const plateOutlineVar = ${q(`var(--${P}-color-${T.plate.outline})`)};

/** Descending, for a greedy plate-loading solve. */
export const platesDescending: readonly Plate[] = Object.values(plates)
  .slice()
  .sort((a, b) => b.kg - a.kg);
`;

/* -------------------------------------------------------------------- theme.css */

const themeLines = [];
themeLines.push(`  /* Colour - resolved at runtime from tokens.css, so utilities follow the theme. */`);
for (const [k] of colorEntries) themeLines.push(`  --color-${k}: var(--${P}-color-${k});`);
themeLines.push(``, `  /* Plate colours (theme-independent). */`);
for (const [k] of Object.entries(T.plate.iwf)) {
  // Both sides go through cssIdent. Sanitising only the Tailwind-side name is what
  // left three of these pointing at a var() that does not exist.
  themeLines.push(`  --color-plate-${cssIdent(k)}: var(--${P}-plate-${cssIdent(k)}-fill);`);
  themeLines.push(
    `  --color-plate-${cssIdent(k)}-label: var(--${P}-plate-${cssIdent(k)}-label);`,
  );
}
themeLines.push(``, `  /* Spacing - Tailwind's --spacing-* namespace. */`);
for (const [k] of Object.entries(T.space)) themeLines.push(`  --spacing-${k}: var(--${P}-space-${k});`);
for (const [k] of Object.entries(T.hit)) themeLines.push(`  --spacing-hit-${k}: var(--${P}-hit-${k});`);
themeLines.push(``, `  /* Radius */`);
for (const [k] of Object.entries(T.radius)) themeLines.push(`  --radius-${k}: var(--${P}-radius-${k});`);
themeLines.push(``, `  /* Border widths. Tailwind v4 has no border-width namespace, so these`);
themeLines.push(`     pass through as plain custom properties: border-[length:var(--border-hairline)]. */`);
for (const [k] of Object.entries(T.border)) themeLines.push(`  --border-${k}: var(--${P}-border-${k});`);
themeLines.push(``, `  /* Type */`);
for (const [k] of Object.entries(T.type)) {
  themeLines.push(`  --text-${k}: var(--${P}-text-${k});`);
  themeLines.push(`  --text-${k}--line-height: var(--${P}-leading-${k});`);
  themeLines.push(`  --text-${k}--font-weight: var(--${P}-weight-${k});`);
  themeLines.push(`  --text-${k}--letter-spacing: var(--${P}-tracking-${k});`);
}
themeLines.push(``, `  /* Fonts */`);
for (const [k] of Object.entries(T.font)) themeLines.push(`  --font-${k}: var(--${P}-font-${k});`);
themeLines.push(``, `  /* Motion */`);
for (const [k] of Object.entries(T.motion.easing)) themeLines.push(`  --ease-${k}: var(--${P}-ease-${k});`);
for (const [k] of Object.entries(T.motion.duration)) themeLines.push(`  --duration-${k}: var(--${P}-duration-${k});`);

const themeCss = `${BANNER('dist/theme.css')}
/*
 * Tailwind v4 theme block. Import AFTER tokens.css:
 *
 *   @import "@freeforever/design-system/tokens.css";
 *   @import "tailwindcss";
 *   @import "@freeforever/design-system/theme.css";
 *
 * Every value here points at a custom property rather than a literal, so a utility
 * such as \`bg-surface\` re-resolves when the theme changes without a rebuild.
 *
 * \`--*: initial\` clears Tailwind's stock palette and spacing scale first. That is
 * the mechanism behind ADR-0021: \`bg-red-500\` and \`p-7\` stop existing, so a raw
 * value cannot enter the app through a utility class either.
 */
@theme {
  --color-*: initial;
  --spacing-*: initial;
  --radius-*: initial;
  --text-*: initial;
  --font-*: initial;
  --ease-*: initial;

${themeLines.join('\n')}
}
`;

assertValidCustomProperties(tokensCss, 'dist/tokens.css');
assertValidCustomProperties(themeCss, 'dist/theme.css');
// tokens.ts is not CSS, but the var() strings it hands to callers are.
assertValidCustomProperties(tokensTs, 'dist/tokens.ts');

mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'tokens.css'), tokensCss);
writeFileSync(join(dist, 'tokens.ts'), tokensTs);
writeFileSync(join(dist, 'theme.css'), themeCss);

const n = colorEntries.length;
console.log(`design-system tokens: ${n} colours x 2 themes -> dist/tokens.css, dist/tokens.ts, dist/theme.css`);
