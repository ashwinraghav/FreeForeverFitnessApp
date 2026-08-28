# Emulator seed fixtures

Local development runs entirely on the Firebase Emulator Suite. No GCP account,
no project, no billing, no keys (ADR-0010).

```bash
node infra/seed/dev.mjs
```

That starts the emulators, waits for them to serve, loads the fixtures, and
stays running. Ctrl-C stops everything.

| File | What it is |
|---|---|
| `dev.mjs` | Start emulators + seed + stay running. The one command. |
| `seed.mjs` | Load fixtures into already-running emulators. Idempotent — it wipes first. |
| `fixtures/auth.json` | Three accounts covering the ADR-0009 auth states. |
| `fixtures/firestore.json` | Documents under `users/{uid}/…`, the only subtree `firestore.rules` permits. |

Both scripts have **zero dependencies** and use only Node 22 built-ins, because
they have to work before `pnpm install` has ever succeeded.

## The project ID is `demo-freeforever`

The `demo-` prefix is a Firebase tooling guarantee: requests for such a project
can never reach a real backend. There is no misconfiguration that turns a local
run into a cloud bill.

## Re-seeding

`seed.mjs` wipes Auth and Firestore before writing, so every run lands on the
same known state rather than on the residue of yesterday's debugging.

```bash
node infra/seed/seed.mjs      # emulators already running
```

## The fixture shape is provisional

`packages/data` (team **domain-model**) owns the real schema. Paths and field
names live in `fixtures/firestore.json` as data rather than in `seed.mjs` as
code, so re-pointing them at the real schema is a JSON edit. If a path here has
drifted from `firestore.rules`, this file is the thing that is wrong.

## Two fixtures worth knowing about

- `users/seed-returning/aggregates/weekly-volume` — ADR-0005 says charts read a
  materialised aggregate, never a Firestore query. This is the document an
  insights view is allowed to open.
- `users/seed-returning/quotas/ai` — seeded at 18 of 20 daily calls, so the
  degraded deterministic path (ADR-0016) is the default thing a developer sees
  rather than an edge case nobody exercises.

## Port 5000

The Hosting emulator wants port 5000, which macOS hands to AirPlay Receiver by
default. `dev.mjs` detects this, drops Hosting, and carries on — Auth and
Firestore are what the app needs. To get Hosting back:

*System Settings → General → AirDrop & Handoff → AirPlay Receiver: off*
