import type { IsoWeek, LengthDisplayUnit, LocalDate, MassDisplayUnit } from '@freeforever/data';
import { CENTIMETRES_PER_INCH, KILOGRAMS_PER_POUND } from './constants';
import { isoWeekStart, parseLocalDate } from './weeks';

/**
 * Display formatting.
 *
 * Storage is canonical (kg, cm, seconds) and a converted number is a string on its
 * way to the DOM — it never travels back. Everything in here returns a string for
 * exactly that reason. The conversion factors come from `./constants`, which is a
 * CI-checked mirror of `@freeforever/data` — see the note there for why the barrel is
 * not imported directly.
 */

export function toDisplayMass(kg: number, unit: MassDisplayUnit): number {
  return unit === 'lb' ? kg / KILOGRAMS_PER_POUND : kg;
}

export function toDisplayLength(cm: number, unit: LengthDisplayUnit): number {
  return unit === 'in' ? cm / CENTIMETRES_PER_INCH : cm;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export interface Measure {
  readonly value: string;
  readonly unit: string;
}

/**
 * A measure split into its number and its unit.
 *
 * The split exists for the headline figure. Set at display size, "185.4 lb" is about
 * a third wider than "185.4" — enough that at a 200% text setting it ran out of a
 * 412px phone and had to either clip or break, putting "lb" on its own line. Setting
 * the unit a size down keeps them on one line at every text size, and reads better:
 * the number is the thing, the unit is the annotation.
 */
export function measureMass(kg: number, unit: MassDisplayUnit, places = 1): Measure {
  return { value: round(toDisplayMass(kg, unit), places).toLocaleString(), unit };
}

/** A load or bodyweight, converted and rounded to the precision anyone can perceive. */
export function formatMass(kg: number, unit: MassDisplayUnit, places = 1): string {
  const parts = measureMass(kg, unit, places);
  return `${parts.value} ${parts.unit}`;
}

export function formatLength(cm: number, unit: LengthDisplayUnit): string {
  return `${round(toDisplayLength(cm, unit), 1).toLocaleString()} ${unit}`;
}

/**
 * Weekly volume runs to six figures fast, and a six-figure number on an axis tick is
 * unreadable at arm's length. Compact it, but only above the point where precision
 * stops mattering — 9,400kg is a real number a lifter recognises; 94,000 is a size.
 */
export function formatCompact(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${round(value / 1_000_000, 1)}M`;
  if (magnitude >= 10_000) return `${round(value / 1000, 1)}k`;
  return Math.round(value).toLocaleString();
}

export function measureVolume(kg: number, unit: MassDisplayUnit): Measure {
  return { value: formatCompact(toDisplayMass(kg, unit)), unit };
}

/** Volume for an axis tick or a tile: compacted, unit-suffixed, never a raw float. */
export function formatVolume(kg: number, unit: MassDisplayUnit): string {
  const parts = measureVolume(kg, unit);
  return `${parts.value} ${parts.unit}`;
}

export function formatDurationHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours >= 10 ? `${Math.round(hours)} h` : `${round(hours, 1)} h`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `12 Mar`. The week's Monday, because a week label nobody can date is decoration. */
export function formatWeekLabel(week: IsoWeek): string {
  const start = isoWeekStart(week);
  if (start === null) return week;
  return `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()] ?? ''}`.trim();
}

export function formatDateShort(date: LocalDate): string {
  const parsed = parseLocalDate(date);
  if (parsed === null) return date;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()] ?? ''}`.trim();
}

export function formatDateLong(date: LocalDate): string {
  const parsed = parseLocalDate(date);
  if (parsed === null) return date;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()] ?? ''} ${parsed.getUTCFullYear()}`;
}

/**
 * A signed change, for a stat tile.
 *
 * Returns null when there is nothing honest to compare against. A "+100%" produced
 * by dividing by a zero baseline is the kind of number that makes a whole screen
 * untrustworthy, and it always shows up in week one when the baseline really is zero.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0 || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/** Neutral, countable, no adjective. "4 weeks" reads the same whether it is good news. */
export function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}
