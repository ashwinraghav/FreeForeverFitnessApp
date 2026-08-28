#!/usr/bin/env node
// Create the next numbered ADR. Usage: pnpm adr "Use X instead of Y"
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const title = process.argv.slice(2).join(" ").trim();
if (!title) {
  console.error('Usage: pnpm adr "Short decision title"');
  process.exit(1);
}

const dir = join(process.cwd(), "docs", "decisions");
const next =
  Math.max(
    0,
    ...readdirSync(dir)
      .map((f) => Number.parseInt(f.slice(0, 4), 10))
      .filter(Number.isInteger),
  ) + 1;

const id = String(next).padStart(4, "0");
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const path = join(dir, `${id}-${slug}.md`);
const today = new Date().toISOString().slice(0, 10);

writeFileSync(
  path,
  `# ADR-${id}: ${title}

- **Status:** Proposed
- **Date:** ${today}
- **Decided by:** 

## Context

## Decision

## Consequences

## Alternatives considered
`,
);
console.log(path);
