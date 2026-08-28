/** Join class names, dropping anything falsy. */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}
