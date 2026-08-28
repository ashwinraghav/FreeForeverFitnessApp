# ADR-0027: Calorie targets have hard, explained safety floors

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Nutrition team, ratified by the project owner with Claude Opus 5 (session 60f2e23f)
- **Relates to:** [ADR-0017](./0017-no-public-social-feed.md), [ADR-0001](./0001-free-forever-constitution.md)

## Context

This app computes calorie targets and shows them to people trying to change their bodies.
That is a body-image-adjacent product, and the failure mode is not a wrong number — it is
a number that is technically derivable, confidently presented, and harmful to act on.

The pressure to relax a floor always arrives as a reasonable individual request: someone
wants a faster cut, or a target the tool refuses to print. A convention bends under that.
A recorded decision does not bend without someone knowingly overturning it.

## Decision

Prescribed intake is clamped, and **every clamp is reported rather than silently applied**.

| Bound | Value | Reasoning |
|---|---|---|
| Absolute floor | 1200 kcal female, 1500 kcal male, 1200 unspecified | Below these a diet cannot reliably meet micronutrient requirements from food. `unspecified` takes the lower value so a small person is not pushed to eat above their own maintenance; the BMR floor is what actually protects them. |
| Individualised floor | `max(absolute, BMR × 1.0)` | BMR is what the body spends existing. Sustained intake beneath it is the regime that drives lean-mass loss and metabolic adaptation. This is the floor that usually binds. |
| Max deficit | 25% of TDEE | |
| Max surplus | 20% of TDEE | Asymmetric on purpose: past roughly a fifth over maintenance, additional energy reliably becomes fat rather than lean mass, so a bigger number is not a faster result. |
| Max rate of change | ~1% of bodyweight per week | |
| Goal weight | not below BMI 18.5 | |
| Age | targets validated for 18+ | |

Three properties make this binding rather than decorative:

1. **`max(absolute, BMR)`, not either alone.** A single fixed floor is wrong for both a
   large athlete and a small sedentary person.
2. **Every clamp is surfaced with a named reason** (`energy_raised_to_bmr_floor` and
   siblings). A silent clamp teaches the user their input was accepted and leaves them
   confused when the number does not match; a reported one explains itself.
3. **Manual entry gets the same floors.** A hand-typed target is the exact path someone
   takes to defeat a computed one, so exempting it would make the whole thing ornamental.

For a sedentary user this caps the achievable deficit near 17%. That is the honest answer,
not a limitation of the tool, and it should be presented that way.

## Consequences

The app will sometimes refuse to show a number a user explicitly asked for, and some of
those users will be annoyed. That is the intended trade. Constitution rule 6 forbids dark
patterns; a product that will compute any number you ask it for, in this category, is one.

**The unresolved risk, stated plainly: no clinician has reviewed these values.** They are
the nutrition team's defensible reading of general-population guidance, and they are
recorded here at that strength and no higher. This ADR does not make them clinically
validated — it makes them *visible*, so review can be assigned rather than assumed.
A registered dietitian should check this table before any public release, and this ADR
should be superseded with their input.

That gap is also the reason for [ADR-0001](./0001-free-forever-constitution.md)'s refusal
of clinical and GLP-1 features: the moment the product advises rather than calculates, it
needs a licence we do not have.

## Alternatives considered

Floors as constants in the nutrition module with no ADR — the status quo before this. They
were correct, but a constant is edited in a pull request and an ADR is overturned in one;
the difference matters for a value whose whole job is to resist a plausible argument.

A warning instead of a clamp. Rejected — a dismissible warning above a harmful number is
worse than no number, because it transfers responsibility to the person least equipped to
carry it while still printing the figure.
