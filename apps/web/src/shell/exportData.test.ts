import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, collectLocalData, exportFilename } from './exportData';

const fake = (entries: Record<string, string>): Storage => {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => entries[k] ?? null,
  } as unknown as Storage;
};

describe('collectLocalData', () => {
  /*
   * Enumerated by prefix rather than from a list, because a list goes stale the
   * first time a team adds a key without knowing this file exists — and the
   * failure is a silent partial export. These are the real key shapes, both
   * separator conventions, taken from a browser.
   */
  it('takes every app key under either separator convention', () => {
    const out = collectLocalData(
      fake({
        'ff.workout.history.v1': '[{"id":"a"}]',
        'ff.workout.active.v1': '{"v":1}',
        'ff.workout.discarded.v1': '[]',
        'ff:nutrition:v1': '{"recipes":[]}',
        'ff:localdata': '"stamp"',
      }),
    );
    expect(Object.keys(out.data).sort()).toEqual([
      'ff.workout.active.v1',
      'ff.workout.discarded.v1',
      'ff.workout.history.v1',
      'ff:localdata',
      'ff:nutrition:v1',
    ]);
  });

  it('leaves other origins’ keys alone', () => {
    const out = collectLocalData(fake({ theme: 'dark', 'ffmpeg-settings': '{}', 'ff.a': '1' }));
    // `ffmpeg-settings` is not ours: the separator is what makes the prefix ours.
    expect(Object.keys(out.data)).toEqual(['ff.a']);
  });

  it('preserves structure rather than flattening to strings', () => {
    const out = collectLocalData(fake({ 'ff.workout.history.v1': '[{"id":"a","sets":2}]' }));
    expect(out.data['ff.workout.history.v1']).toEqual([{ id: 'a', sets: 2 }]);
  });

  it('reports an unreadable value instead of losing the rest of the export', () => {
    const out = collectLocalData(fake({ 'ff.good': '{"ok":true}', 'ff.broken': '{not json' }));
    expect(out.data['ff.good']).toEqual({ ok: true });
    expect(out.unreadable).toEqual(['ff.broken']);
    // The point: a corrupt value is named, not silently dropped. An export that
    // quietly omits something is worse than one that admits a gap.
    expect(Object.keys(out.data)).not.toContain('ff.broken');
  });

  it('is self-describing, so a file found in a year is identifiable', () => {
    const out = collectLocalData(fake({ 'ff.a': '1' }));
    expect(out.format).toBe(EXPORT_FORMAT);
    expect(out.version).toBe(1);
    expect(Date.parse(out.exportedAt)).not.toBeNaN();
  });

  it('names the file by date so several sort in order', () => {
    expect(exportFilename(new Date('2026-09-01T14:05:00Z'))).toBe('freeforever-export-2026-09-01.json');
  });
});
