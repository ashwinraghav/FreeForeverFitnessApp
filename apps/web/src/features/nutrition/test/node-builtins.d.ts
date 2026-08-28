/**
 * Minimal ambient declarations for the Node built-ins used by this feature's
 * *tests* only.
 *
 * `apps/web/tsconfig.json` declares `types: ["vite/client", …]` and the app has
 * no `@types/node`, which is correct — nothing the browser ships may import a
 * Node built-in, and the absence of the types is what enforces that. But
 * `search/recall.test.ts` reads the committed index artefacts off disk to
 * measure recall against real data, and that runs in vitest's Node
 * environment.
 *
 * Declaring only the four functions those tests call keeps the enforcement
 * intact: an accidental `readFileSync` in application code still has to come
 * through this file, which is obviously test scaffolding.
 *
 * DELETE THIS once `@types/node` is a devDependency of `apps/web` — that is an
 * app-config change and belongs to the integrator (ADR-0018).
 */

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:zlib' {
  export function gunzipSync(buffer: Uint8Array): Uint8Array;
}

declare module 'node:path' {
  export function join(...segments: string[]): string;
  export function dirname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

/** Only `cwd`, only for resolving fixture paths in tests. */
declare const process: { cwd(): string };
