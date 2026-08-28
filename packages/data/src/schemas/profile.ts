import { z } from 'zod';
import { displayNameSchema, documentEnvelopeSchema } from '../common/envelope.js';
import { routineIdSchema, userIdSchema } from '../common/ids.js';
import { localDateSchema } from '../common/time.js';
import { bodyLengthCmSchema, durationSecondsSchema, unitPreferencesSchema } from '../common/units.js';
import { activityLevelSchema, goalSchema } from './nutrition.js';

/**
 * The user profile — one document at `/users/{uid}`.
 *
 * Everything here is preference and context. Nothing here is authorisation: the
 * profile is written by the user, so a rule must never read a field from it to decide
 * what the user may do. Authorisation comes from `request.auth.uid` and from grant
 * documents the user cannot forge.
 *
 * Two things this document deliberately does not hold: any API key (ADR-0016 keeps a
 * bring-your-own key device-local, never synced), and any field that would let one
 * user find another (ADR-0017 — there is no directory, so there is nothing to search).
 */

export const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const experienceLevelSchema = z.enum(EXPERIENCE_LEVELS);
export type ExperienceLevel = z.infer<typeof experienceLevelSchema>;

/**
 * Used only as an input to BMR estimation, which is the one place the formulas
 * differ. Optional, and `unspecified` picks the average of the two coefficients
 * rather than refusing to produce a number.
 */
export const BIOLOGICAL_SEX_VALUES = ['female', 'male', 'unspecified'] as const;
export const biologicalSexSchema = z.enum(BIOLOGICAL_SEX_VALUES);
export type BiologicalSex = z.infer<typeof biologicalSexSchema>;

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export const themePreferenceSchema = z.enum(THEME_PREFERENCES);

/**
 * Recorded from `request.auth` at write time for the user's own information — "you
 * have not linked an account yet, your data lives on this device's login". It is a
 * mirror, never a source of truth, and no rule reads it. An anonymous user has
 * exactly the same rights as a linked one (ADR-0009).
 */
export const authMirrorSchema = z.strictObject({
  isAnonymous: z.boolean(),
  linkedProviders: z.array(z.enum(['password', 'google.com', 'apple.com', 'emailLink'])).max(8),
});

export const profileSchema = documentEnvelopeSchema.extend({
  /** Equals the uid. The document id is the uid too. */
  id: userIdSchema,
  displayName: displayNameSchema.optional(),
  locale: z.string().max(35).optional(),
  /** IANA zone, e.g. `Europe/London`. Used to compute the local day boundary. */
  timeZone: z.string().max(64).optional(),
  units: unitPreferencesSchema,
  theme: themePreferenceSchema,
  heightCm: bodyLengthCmSchema.optional(),
  /**
   * Birth date, for age in BMR estimation. Stored as a local date because the only
   * thing derived from it is a year count.
   */
  birthDate: localDateSchema.optional(),
  biologicalSex: biologicalSexSchema.optional(),
  goal: goalSchema.optional(),
  activityLevel: activityLevelSchema.optional(),
  experienceLevel: experienceLevelSchema.optional(),
  /** Default rest between sets, used when a routine does not prescribe one. */
  defaultRestSec: durationSecondsSchema,
  /** What the home screen jumps into. Denormalised to avoid a query on cold start. */
  activeRoutineId: routineIdSchema.optional(),
  onboardingCompletedOn: localDateSchema.optional(),
  auth: authMirrorSchema,
  /** Opt-in, off by default, and every feature works with all of these false. */
  consent: z.strictObject({
    analytics: z.boolean(),
    /** Send anonymised prompts to the hosted AI proxy (ADR-0016). */
    hostedAi: z.boolean(),
  }),
});

export type Profile = z.infer<typeof profileSchema>;
