import type { Ctx2D } from '../charts/draw';

export interface RecordedCall {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly state: {
    readonly fillStyle: string;
    readonly strokeStyle: string;
    readonly lineWidth: number;
  };
}

/**
 * A recording stand-in for `CanvasRenderingContext2D`.
 *
 * jsdom's `getContext('2d')` returns null, so the usual answer to "how do you test a
 * canvas chart" is "you don't". Recording every call against the small structural
 * interface the draw programs are written to gets the geometry under test without a
 * browser: bar widths, the baseline, which labels were emitted, how thick the line
 * is. That is most of what actually breaks.
 */
export class RecordingCtx implements Ctx2D {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  lineJoin: CanvasLineJoin = 'miter';
  lineCap: CanvasLineCap = 'butt';
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  readonly calls: RecordedCall[] = [];

  private record(op: string, ...args: unknown[]): void {
    this.calls.push({
      op,
      args,
      state: {
        fillStyle: this.fillStyle,
        strokeStyle: this.strokeStyle,
        lineWidth: this.lineWidth,
      },
    });
  }

  save(): void { this.record('save'); }
  restore(): void { this.record('restore'); }
  setTransform(...args: number[]): void { this.record('setTransform', ...args); }
  clearRect(x: number, y: number, w: number, h: number): void { this.record('clearRect', x, y, w, h); }
  beginPath(): void { this.record('beginPath'); }
  closePath(): void { this.record('closePath'); }
  moveTo(x: number, y: number): void { this.record('moveTo', x, y); }
  lineTo(x: number, y: number): void { this.record('lineTo', x, y); }
  arc(x: number, y: number, r: number): void { this.record('arc', x, y, r); }
  rect(x: number, y: number, w: number, h: number): void { this.record('rect', x, y, w, h); }
  roundRect(x: number, y: number, w: number, h: number, radii: readonly number[]): void {
    this.record('roundRect', x, y, w, h, radii);
  }
  fill(): void { this.record('fill'); }
  stroke(): void { this.record('stroke'); }
  fillText(text: string, x: number, y: number): void { this.record('fillText', text, x, y); }

  /**
   * A stable 7px-per-character stand-in. The label-thinning logic only needs a width
   * that grows with the string, and a real font metric would make the test flaky.
   */
  measureText(text: string): { width: number } {
    return { width: text.length * 7 };
  }

  ops(op: string): readonly RecordedCall[] {
    return this.calls.filter((call) => call.op === op);
  }

  texts(): readonly string[] {
    return this.ops('fillText').map((call) => String(call.args[0]));
  }
}
