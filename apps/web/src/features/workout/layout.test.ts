import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The shell owns the edges of the viewport. This feature may not reach them.
 *
 * ## Why this is a stylesheet test and not a layout test
 *
 * The bug it exists for: `.ffw-restbar` and `.ffw-actions` were `position: fixed;
 * bottom: 0`, which positions against the viewport — and the bottom of the viewport is
 * where `AppFrame` puts the Train/Eat/Progress tab bar. The two rows painted straight
 * over it, so the screen the app opens on had no visible navigation and no route to
 * any other section of the app.
 *
 * Nothing caught it, and a DOM assertion could not have. The tabs were rendered,
 * attached, and reported as in-viewport the whole time — they were simply underneath.
 * The only signal was pixels. **jsdom has no layout engine**: it does not resolve
 * stylesheets into geometry and `getBoundingClientRect` returns zeroes, so a test
 * comparing the two bounding boxes would pass against both the broken and the fixed
 * code, which is worse than no test.
 *
 * So this asserts the *rule* instead of the symptom, at the only layer where the rule
 * is visible: the stylesheet. It is a weaker check than a real overlap measurement,
 * and it is honest about that — but it is mechanical, it fails on the exact edit that
 * caused the outage, and it catches the next component that reaches for the bottom of
 * the screen. Real geometry is verified in a browser at a real viewport; that part
 * cannot be automated here.
 */

// `TextDecoder` rather than `readFileSync(path, 'utf8')`: `@types/node` is not in this
// package's tsconfig `types` array, so the encoding overload is not visible and
// `Buffer` degrades to `Object`. `TextDecoder` comes from lib.dom and needs no extras.
const CSS = new TextDecoder().decode(
  readFileSync(fileURLToPath(new URL('./workout.css', import.meta.url))),
);

/** Strip comments so the prose explaining the rule is not mistaken for breaking it. */
const DECLARATIONS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the workout feature never fixes anything to the viewport', () => {
  it('uses no position: fixed at all', () => {
    // `fixed` is the mechanism: it escapes the shell's grid and lands on top of
    // whatever the shell had put there. `sticky` inside `.ff-main` cannot, because
    // the scroll container ends exactly where the tab bar begins.
    expect(DECLARATIONS).not.toMatch(/position:\s*fixed/);
  });

  it('pins its bottom dock with sticky instead', () => {
    expect(DECLARATIONS).toMatch(/\.ffw-dock\s*\{[^}]*position:\s*sticky/);
    expect(DECLARATIONS).toMatch(/\.ffw-dock\s*\{[^}]*bottom:\s*0/);
  });

  it('does not put the action bar or the rest bar at the viewport edge', () => {
    // Either of these owning `bottom: 0` outside the dock would put it back over the
    // tab bar the moment someone made it positioned again.
    for (const selector of ['.ffw-actions', '.ffw-restbar']) {
      const block = blockFor(selector);
      expect(block, `${selector} should exist`).not.toBeNull();
      expect(block).not.toMatch(/position:/);
      expect(block).not.toMatch(/bottom:\s*0/);
    }
  });

  it('does not stack the dock above the sheet', () => {
    /*
     * The dock carrying a `z-index` is what put the action bar over the bottom of the
     * open exercise picker: `.ff-sheet` is left at `z-index: auto` by the design
     * system, so any positive value on the dock outranks it and roughly a set-row and
     * a half of the list became visible but untappable — tapping the exercise you
     * could see re-opened the picker.
     *
     * `sticky` already lifts the dock above the non-positioned cards. Among the
     * positioned siblings, paint order is DOM order, which is the order the screen
     * renders them: dock, picker, toasts. No numbers needed, and a number here is a
     * regression.
     */
    expect(blockFor('.ffw-dock')).not.toMatch(/z-index/);
  });

  it('leaves the safe-area inset to the shell, which owns the screen edge', () => {
    // The tab bar already pads for the home indicator. A second element padding for
    // it while sitting above the tab bar just adds a gap.
    expect(blockFor('.ffw-dock')).not.toMatch(/safe-area-inset-bottom/);
  });
});

describe('the card is one table, not three layouts stacked', () => {
  /*
   * A user described the header row as "slightly misaligned" and the card as noisy.
   * Two of the three causes are geometry a browser can see and jsdom cannot, so these
   * assert the rule at the layer where the rule lives — the same trade this file's
   * header explains. The alignment itself was verified in Chrome at 412px.
   */

  it('puts the legend, the rows and the history strip on the same track list', () => {
    // The history strip used to run `5rem | 1fr | auto`, which matched none of the
    // four columns beneath it. Three grids, one card.
    for (const selector of ['.ffw-sets__legend', '.ffw-row', '.ffw-history__row']) {
      expect(blockFor(selector)).toMatch(/grid-template-columns:\s*var\(--ffw-cols\)/);
    }
  });

  it('aligns each legend header the way its own column aligns its content', () => {
    // Every header was start-aligned while the value cells centre their numbers, so
    // "REPS" sat a whole cell-padding left of the inputs it named.
    expect(DECLARATIONS).toMatch(/\.ffw-sets__legend > span[\s\S]*?text-align/);
  });

  it('lets both control rows break rather than run off the right edge', () => {
    // The rest bar has already put the button that ends the rest off-screen once. It
    // does it again at 200% text, where nothing in either row can shrink.
    expect(blockFor('.ffw-restbar__body')).toMatch(/flex-wrap:\s*wrap/);
    expect(blockFor('.ffw-actions')).toMatch(/flex-wrap:\s*wrap/);
    // A zero flex basis can never be larger than the line, so the row can never break.
    expect(blockFor('.ffw-actions > *')).not.toMatch(/flex:\s*1;/);
  });
});

describe('large text is a layout condition, not a screen-size one', () => {
  /*
   * At 200% text on a 412px phone the spacing tokens double — they are `rem` — so the
   * index and log columns take 192px of the 348px a row has, and the two value cells
   * came out at 47px and 61px, under ADR-0013's 48px floor on the control the screen
   * exists to serve. Dropping the least-read column leaves 54px each. Measured in Chrome;
   * jsdom reports all of it as zero, so what is asserted here is the mechanism.
   */

  it('reacts to text size with a container query in em, not a width media query', () => {
    // The viewport is not narrow; the *text* is large. `em` inside `@container` resolves
    // against the font size, so 412px reads as 25.8em at 100% and 12.9em at 200% — the
    // query fires on the condition that is actually broken. A `max-width` media query
    // would punish the 412px phone this app is designed for and miss the real case.
    expect(DECLARATIONS).toMatch(/@container \(inline-size < \d+em\)/);
    expect(DECLARATIONS).toMatch(/\.ffw-card\s*\{[^}]*container-type:\s*inline-size/);
  });

  it('restates the track list on the rows, never as a variable on the container', () => {
    /*
     * An element is never its own query container. A `.ffw-card` rule inside the block
     * resolves against the card's *ancestor* container, of which there is none — so the
     * first attempt hid the column while leaving five tracks in place, and the cells got
     * narrower rather than wider: 34px, measured. It failed silently and every test
     * stayed green, which is exactly why this one is here.
     */
    const query = /@container[^{]*\{([\s\S]*?)\n\}/.exec(DECLARATIONS)?.[1] ?? '';
    expect(query).not.toMatch(/\.ffw-card\s*\{/);
    expect(query).toMatch(/\.ffw-row,[\s\S]*?grid-template-columns/);
  });

  it('keeps the history strip on the same tracks when a column is dropped', () => {
    // Otherwise the volume asks for a fifth column, grid invents an implicit one, and the
    // strip stops agreeing with the table under it — which is what sharing tracks was for.
    const query = /@container[^{]*\{([\s\S]*?)\n\}/.exec(DECLARATIONS)?.[1] ?? '';
    expect(query).toMatch(/\.ffw-history__volume\s*\{\s*grid-column: 4/);
  });

  it('pins the set editor to its container rather than letting it size to content', () => {
    // An implicit grid track is `auto` and free to grow past the container. At 200% the
    // stepper row's min-content is ~483px, so inside 412px the "+" stepper and half of
    // "Done" were off the right edge — unreachable, not merely clipped.
    expect(blockFor('.ffw-editor')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});

function blockFor(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(DECLARATIONS);
  return match === null ? null : (match[1] as string);
}
