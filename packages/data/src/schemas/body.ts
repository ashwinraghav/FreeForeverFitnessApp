import { z } from 'zod';
import { documentEnvelopeSchema, shortTextSchema } from '../common/envelope.js';
import { bodyMetricIdSchema, progressPhotoIdSchema } from '../common/ids.js';
import { epochMillisSchema, localDateSchema, tzOffsetMinutesSchema } from '../common/time.js';
import { bodyLengthCmSchema, massKgSchema } from '../common/units.js';

/**
 * Body metrics and progress photos.
 *
 * A body metric document is keyed by local date, so weighing yourself twice on one
 * day updates one document rather than creating two the trend line has to reconcile.
 * Offline, that also makes the write idempotent: two devices that both logged
 * Tuesday's weight converge instead of duplicating it.
 */

export const bodyMeasurementsSchema = z.strictObject({
  neckCm: bodyLengthCmSchema.optional(),
  shouldersCm: bodyLengthCmSchema.optional(),
  chestCm: bodyLengthCmSchema.optional(),
  waistCm: bodyLengthCmSchema.optional(),
  hipsCm: bodyLengthCmSchema.optional(),
  leftArmCm: bodyLengthCmSchema.optional(),
  rightArmCm: bodyLengthCmSchema.optional(),
  leftThighCm: bodyLengthCmSchema.optional(),
  rightThighCm: bodyLengthCmSchema.optional(),
  leftCalfCm: bodyLengthCmSchema.optional(),
  rightCalfCm: bodyLengthCmSchema.optional(),
});

export type BodyMeasurements = z.infer<typeof bodyMeasurementsSchema>;

export const BODY_FAT_METHODS = ['skinfold', 'bioimpedance', 'dexa', 'navy_tape', 'estimate'] as const;
export const bodyFatMethodSchema = z.enum(BODY_FAT_METHODS);
export type BodyFatMethod = z.infer<typeof bodyFatMethodSchema>;

export const bodyMetricSchema = documentEnvelopeSchema
  .extend({
    /** Equals the local date. `YYYY-MM-DD`. */
    id: bodyMetricIdSchema,
    localDate: localDateSchema,
    tzOffsetMinutes: tzOffsetMinutesSchema,
    measuredAt: epochMillisSchema,
    weightKg: massKgSchema.optional(),
    bodyFatPercent: z.number().min(1).max(75).optional(),
    bodyFatMethod: bodyFatMethodSchema.optional(),
    measurements: bodyMeasurementsSchema.optional(),
    restingHeartRateBpm: z.number().int().min(20).max(220).optional(),
    /** 1-5, one tap. Cheap to log, and the best predictor of adherence falling over. */
    sleepQuality: z.number().int().min(1).max(5).optional(),
    note: shortTextSchema.optional(),
  })
  .refine(
    (metric) => metric.bodyFatMethod === undefined || metric.bodyFatPercent !== undefined,
    'bodyFatMethod without a bodyFatPercent measures nothing',
  );

export type BodyMetric = z.infer<typeof bodyMetricSchema>;

export const PHOTO_POSES = ['front_relaxed', 'side_relaxed', 'back_relaxed', 'front_flexed', 'other'] as const;
export const photoPoseSchema = z.enum(PHOTO_POSES);
export type PhotoPose = z.infer<typeof photoPoseSchema>;

/**
 * Metadata only. The image bytes live in Cloud Storage under the user's own prefix
 * and are governed by Storage rules, not these ones — a progress photo is the most
 * sensitive thing this app holds, and no grant, group or export path exposes one
 * without the user acting.
 */
export const progressPhotoSchema = documentEnvelopeSchema.extend({
  id: progressPhotoIdSchema,
  localDate: localDateSchema,
  tzOffsetMinutes: tzOffsetMinutesSchema,
  takenAt: epochMillisSchema,
  pose: photoPoseSchema,
  /** Path within the user's own Storage prefix. Never a full URL, never signed. */
  storagePath: z.string().min(1).max(512),
  widthPx: z.number().int().min(1).max(20_000),
  heightPx: z.number().int().min(1).max(20_000),
  byteSize: z.number().int().min(0).max(50_000_000),
  /** Tiny placeholder so a gallery renders before any image loads, and offline. */
  blurhash: z.string().max(64).optional(),
  /** Bodyweight when taken, so the photo means something on its own. */
  weightKg: massKgSchema.optional(),
  note: shortTextSchema.optional(),
});

export type ProgressPhoto = z.infer<typeof progressPhotoSchema>;
