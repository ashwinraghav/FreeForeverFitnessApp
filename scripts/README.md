# scripts

Repository tooling. Deliberately small: anything that must run in CI belongs in a package
script so it can be run identically by hand.

## `new-adr.mjs`

```bash
pnpm adr "Serve exercise media from the repo"
```

Creates the next-numbered record in `docs/decisions/` from the template, with the number
and date filled in. It reads the directory to find the next number rather than taking one
as an argument, because two people picking the same number by hand is exactly the merge
conflict the numbering exists to avoid.

Records are immutable once accepted. If you are reaching for an editor on an existing
record to change what it decided, write a superseding one instead.
