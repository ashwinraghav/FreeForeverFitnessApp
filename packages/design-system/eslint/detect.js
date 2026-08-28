/**
 * Raw-literal detection (ADR-0021).
 *
 * Split out from the rule itself so the matching logic is testable without an
 * ESLint RuleTester, and so other tooling (a codemod, a CI grep) can reuse exactly
 * the same definition of "raw literal" rather than inventing a second one.
 */

/**
 * @typedef {object} RawLiteral
 * @property {'color'|'spacing'|'duration'} kind
 * @property {string} value the exact offending substring
 * @property {string} suggestion what to use instead
 */

/** `#abc`, `#aabbcc`, `#aabbccdd`. */
const HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

/** `rgb(...)`, `rgba(...)`, `hsl(...)`, `oklch(...)` and friends. */
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi;

/**
 * A px length. `0px` is excluded: zero is zero in every scale, and banning it only
 * produces a token named "nothing".
 */
const PX = /(?<![\w.#-])(?!0px\b)\d*\.?\d+px\b/gi;

/**
 * A duration. Requires a digit before the unit and rejects `0s`/`0ms` for the same
 * reason as `0px`. The negative lookbehind keeps it off identifiers like `a11ms`.
 */
const DURATION = /(?<![\w.#-])(?!0m?s\b)\d*\.?\d+m?s\b/gi;

/** Anything already going through a token is fine, by definition. */
const TOKEN_REF = /var\(\s*--ff-/i;

/**
 * Does this string read like a style value rather than like prose?
 *
 * A hex colour is never legitimate copy, so colours are always flagged. Lengths and
 * durations are different: "Rest 90s" and "12px gap" are things a human might
 * actually read on screen. Flagging those produces noise, and a noisy rule gets
 * disabled - which would defeat ADR-0021 entirely. So lengths and durations are only
 * flagged when the string looks like CSS, or when the caller says the literal sits in
 * a style position (a `style` prop, a CSS-in-JS template).
 */
export function looksLikeStyleValue(text) {
  return (
    /[a-z-]+\s*:\s*[^;]+/i.test(text) ||
    /\b(?:margin|padding|gap|inset|width|height|size|radius|top|left|right|bottom|duration|delay|transition|animation|translate|border|font|line-height|spacing|offset|shadow)\b/i.test(
      text,
    ) ||
    /^[\d.\s]*(?:px|m?s)$/i.test(text.trim())
  );
}

const SUGGESTIONS = {
  color: 'use a colour token, e.g. var(--ff-color-accent) or colorVar.accent',
  spacing:
    'use a spacing, radius or hit token, e.g. var(--ff-space-16) / var(--ff-hit-mid-set)',
  duration: 'use a motion token, e.g. var(--ff-duration-base)',
};

/**
 * Find raw design literals in a string.
 *
 * @param {string} text
 * @param {{ allow?: ReadonlyArray<RegExp>, styleContext?: boolean }} [options]
 *   `styleContext` forces length/duration checking on - set it when the literal sits
 *   in a `style` prop or a CSS-in-JS template, where prose is not a possibility.
 * @returns {RawLiteral[]}
 */
export function findRawLiterals(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];

  // A string that is only a token reference is the correct shape, not a violation.
  if (TOKEN_REF.test(text) && !HEX.test(text)) {
    HEX.lastIndex = 0;
  }
  HEX.lastIndex = 0;

  const allow = options.allow ?? [];
  if (allow.some((pattern) => pattern.test(text))) return [];

  /** @type {RawLiteral[]} */
  const found = [];
  const checkLengths = options.styleContext === true || looksLikeStyleValue(text);

  /** @type {Array<[RegExp, RawLiteral['kind']]>} */
  const scans = [
    [HEX, 'color'],
    [COLOR_FN, 'color'],
    ...(checkLengths
      ? /** @type {Array<[RegExp, RawLiteral['kind']]>} */ ([
          [PX, 'spacing'],
          [DURATION, 'duration'],
        ])
      : []),
  ];

  for (const [pattern, kind] of scans) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      found.push({ kind, value: match[0], suggestion: SUGGESTIONS[kind] });
      match = pattern.exec(text);
    }
  }

  return found;
}

/** Paths that legitimately contain raw values: the design system itself. */
export const DEFAULT_IGNORED_PATHS = [
  /packages[\\/]design-system[\\/]/,
  /\.stories\.[jt]sx?$/,
];
