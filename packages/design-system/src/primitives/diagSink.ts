/**
 * A hole for an app to hang a diagnostic recorder on.
 *
 * The design system must not import from `apps/web` — the dependency runs the
 * other way — but a pointer bug lives in these primitives and can only be
 * observed on a real device. So the primitives emit, and whoever wants the
 * events supplies a sink.
 *
 * Default is a no-op, so nothing is recorded and nothing is paid for unless an
 * app deliberately opts in.
 */
export type DiagSink = (tag: string, data?: Record<string, string | number | boolean | null>) => void;

let sink: DiagSink = () => undefined;

export function setDiagSink(next: DiagSink): void {
  sink = next;
}

export function emitDiag(tag: string, data?: Record<string, string | number | boolean | null>): void {
  sink(tag, data);
}
