# ADR-0013: Design direction: blueprint, dark-first

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The governing design constraint is not brand preference; it is the physical situation. A phone held in one chalky hand, in bad light, by someone out of breath, interrupted every ninety seconds, for 45–90 minutes of screen-on time.

## Decision

**Blueprint**: prussian-tinted iron neutrals with a single safety-orange signal — the visual language of engineering drawings and equipment markings. Dark-first with a fully designed light theme. 48px minimum hit targets (56px mid-set), tabular numerals throughout, WCAG 2.2 AA asserted as a unit test so a palette change cannot silently break contrast.

## Consequences

Colour never carries meaning alone — every state also has a glyph or shape, so it survives greyscale, colour-vision deficiency and a sun-washed screen. The one exception is the plate calculator, which uses real IWF plate colours because that is the language already printed on the equipment.

## Alternatives considered

Wellness pastels (wrong for the lighting conditions and the category's honesty problem) and beast-mode black/red (over-claimed, and terrible contrast in a dim gym).
