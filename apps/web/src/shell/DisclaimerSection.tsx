/**
 * "Before you use the numbers", in More.
 *
 * The app computes two things that read like advice and are not: an intake target from
 * general-population formulas, and a suggested next set from arithmetic on your own
 * history. `packages/core/src/nutrition/safety.ts` has said so in a source comment since
 * it was written — "None of this is medical advice and the app must not present it as
 * such" — and that sentence lived nowhere a user could read it. This is where it now
 * lives.
 *
 * ## Why here and not on the targets screen
 *
 * The targets screen is where the number appears, which is the argument for putting it
 * there. Against: that screen is nutrition-owned (ADR-0018) and this is shell, and a
 * disclaimer that appears next to every number becomes furniture people stop seeing. One
 * findable statement beats four ignored ones. A short line beside the target itself is
 * still worth having and belongs to that team.
 *
 * ## Prose is allowed on this screen
 *
 * "No paragraphs in the workout flow" governs Train, not More — the tab a first-time user
 * lands on (`firstRun.ts`) and the one people open when looking for the catch. The
 * existing "How this works" section is four paragraphs for the same reason.
 *
 * ## The link leaves the app
 *
 * There is no in-app legal route yet, so the full text is the repository's `PRIVACY.md`.
 * Styled as a control rather than an inline link: `.ff-control` carries
 * `min-block-size: var(--ff-hit-min)`, so the 48px floor holds without new CSS, and an
 * inline link inside a sentence would lean on WCAG 2.2's target-size exception rather
 * than clearing the bar this project set for itself.
 */

const PRIVACY_URL =
  'https://github.com/ashwinraghav/FreeForeverFitnessApp/blob/main/PRIVACY.md';

export function DisclaimerSection() {
  return (
    <section className="ff-more__group" aria-labelledby="more-disclaimer">
      <h2 className="ff-more__grouptitle" id="more-disclaimer">
        Before you use the numbers
      </h2>
      <div className="ff-more__prose">
        <p>
          <strong>None of this is medical advice.</strong> Your calorie and macro targets are
          estimates from general-population formulas and the four numbers you entered. The
          suggested next set is arithmetic on the sets you logged yourself — it does not know
          whether you slept, or whether something hurts today.
        </p>
        <p>
          The intake maths refuses to go below documented floors, and tells you when it has
          held a number back rather than quietly changing it. That is a guardrail on an
          estimate, not supervision.
        </p>
        <p className="ff-more__note">
          Please talk to a doctor, dietitian or qualified coach before acting on any of it,
          and especially if you are pregnant or breastfeeding, under 18, managing a medical
          condition, or have any history of disordered eating.
        </p>
        <div className="ff-more__actions">
          <a
            className="ff-control ff-focusable ff-more__action"
            href={PRIVACY_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            Privacy, health and liability
          </a>
        </div>
      </div>
    </section>
  );
}
