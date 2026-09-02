import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildReport,
  clearDiagnostics,
  diagnosticsEnabled,
  installGlobalCapture,
  record,
  recordRoute,
  setDiagnostics,
} from './diagnostics';

/**
 * The point of this file is a bug that could not be reproduced off a phone. So
 * the properties that matter are: it records nothing until asked, it cannot grow
 * without limit, and it carries no personal data — a diagnostic that leaks is
 * worse than no diagnostic.
 */
beforeEach(() => {
  setDiagnostics(false);
  clearDiagnostics();
});

describe('diagnostics', () => {
  it('records nothing until it is switched on', () => {
    record('pointer.down');
    expect(buildReport().events).toEqual([]);
    expect(diagnosticsEnabled()).toBe(false);
  });

  it('records once switched on', () => {
    setDiagnostics(true);
    record('repeat.tick', { n: 1 });
    const tags = buildReport().events.map((e) => e.tag);
    expect(tags).toContain('repeat.tick');
  });

  it('notes the moment it was switched on, so the log has a start', () => {
    setDiagnostics(true);
    expect(buildReport().events[0]?.tag).toBe('diagnostics.on');
  });

  it('is bounded, so a long session cannot grow it without limit', () => {
    setDiagnostics(true);
    for (let i = 0; i < 1000; i += 1) record('repeat.tick', { n: i });
    const { events } = buildReport();
    expect(events.length).toBeLessThanOrEqual(400);
    // Keeps the RECENT end: the interesting part is what happened last.
    expect(events[events.length - 1]?.data?.['n']).toBe(999);
  });

  it('is self-describing, so a pasted blob is identifiable a week later', () => {
    const report = buildReport();
    expect(report.format).toBe('thefreeforeverfitnessapp.diagnostics');
    expect(Number.isNaN(Date.parse(report.capturedAt))).toBe(false);
  });

  it('reports capabilities by feature detection, not by sniffing the browser', () => {
    // What matters for a pointer bug is whether the API exists, not what the
    // browser calls itself — and a UA string is far more identifying.
    const caps = buildReport().capabilities;
    expect(Object.keys(caps)).toContain('pointerCapture');
    expect(Object.keys(caps)).toContain('maxTouchPoints');
    expect(JSON.stringify(caps).toLowerCase()).not.toContain('mozilla');
  });

  it('clears on request, so a second attempt starts clean', () => {
    setDiagnostics(true);
    record('repeat.tick');
    clearDiagnostics();
    expect(buildReport().events).toEqual([]);
  });
});

describe('generic capture', () => {
  /*
   * The point of capturing errors and routes generically is that a report is
   * only useful if it contains the failure — and most failures are not in
   * whichever component someone remembered to instrument.
   *
   * The alternative is a third-party crash reporter. This project will not ship
   * one: it is an unbounded per-user cost, a metered dependency on a critical
   * path, and it sends a user's data somewhere without asking.
   */
  it('captures an unhandled error without being told about it in advance', () => {
    installGlobalCapture();
    setDiagnostics(true);
    globalThis.dispatchEvent(
      new ErrorEvent('error', { message: 'boom', filename: '/assets/x.js', lineno: 12 }),
    );
    const found = buildReport().events.find((e) => e.tag === 'error');
    expect(found?.data?.['message']).toBe('boom');
  });

  it('keeps the file and line but never the whole stack', () => {
    installGlobalCapture();
    setDiagnostics(true);
    globalThis.dispatchEvent(
      new ErrorEvent('error', { message: 'x', filename: 'https://host/assets/chunk.js', lineno: 7 }),
    );
    const found = buildReport().events.find((e) => e.tag === 'error');
    // A stack can carry values a user typed; a filename and line cannot.
    expect(found?.data?.['source']).toBe('chunk.js:7');
  });

  it('records the path a user was on, and nothing after it', () => {
    setDiagnostics(true);
    recordRoute('/workout/history');
    const found = buildReport().events.find((e) => e.tag === 'route');
    expect(found?.data?.['path']).toBe('/workout/history');
  });

  it('captures nothing at all while recording is off', () => {
    installGlobalCapture();
    setDiagnostics(false);
    clearDiagnostics();
    globalThis.dispatchEvent(new ErrorEvent('error', { message: 'silent' }));
    recordRoute('/eat');
    expect(buildReport().events).toEqual([]);
  });

  it('installs its listeners only once, however often it is called', () => {
    installGlobalCapture();
    installGlobalCapture();
    installGlobalCapture();
    setDiagnostics(true);
    clearDiagnostics();
    globalThis.dispatchEvent(new ErrorEvent('error', { message: 'once' }));
    const errors = buildReport().events.filter((e) => e.tag === 'error');
    expect(errors).toHaveLength(1);
  });
});
