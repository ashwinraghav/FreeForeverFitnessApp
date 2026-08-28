/**
 * Ambient declarations for the Node built-ins used by *tests* in this app.
 *
 * INTEGRATOR-OWNED (ADR-0018). Ambient declarations are global, so a file like
 * this one silently serves every feature in the package. When it lived under
 * `features/nutrition/test/`, the workout team's `fromDatasets.test.ts` was
 * quietly getting `node:url` from it — and narrowing it for nutrition's needs
 * turned workout's build red. Neither team chose that coupling or could see it;
 * it was an accident of which directory the file happened to sit in. Shared
 * scaffolding belongs somewhere shared.
 *
 * `apps/web/tsconfig.json` sets `types: ["vite/client", …]` with no
 * `@types/node`, deliberately: nothing the browser ships may import a Node
 * built-in, and the absence of those types is what enforces it. Declaring only
 * the handful of functions tests actually call keeps that enforcement intact —
 * an accidental `readFileSync` in application code still has to come through
 * this file, which is obviously test scaffolding.
 *
 * Deliberately NOT declared: `process`. Fixture paths resolve from
 * `import.meta.url` (see the fixture-path helper), because a browser bundle
 * should not have Node globals in scope even in its tests.
 *
 * Add a declaration here only for something a test genuinely needs, and keep it
 * to the narrowest signature that works.
 */

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:zlib' {
  export function gunzipSync(buffer: Uint8Array): Uint8Array;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
