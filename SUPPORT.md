# Getting help

## Something is broken

[Open a bug report](https://github.com/ashwinraghav/FreeForeverFitnessApp/issues/new?template=bug_report.yml).

**We cannot see your data, so we cannot look for ourselves.** There is no account, no
server and no telemetry, which is deliberate and does mean everything we know comes from
what you tell us. Reproduction steps, your screen size and your browser are worth more
here than in most projects.

If it is reproducible, turn on **More → App → Record a problem** first, reproduce it, then
**Copy the log** and paste it into the issue. It records event names, timings and capability
flags — never workout contents, food or photos.

## Your data seems to have gone

Take a copy before doing anything else: **More → App → Download my data**.

The most common cause is clearing browser data, which deletes the app's storage along with
everything else. There is no server-side copy to restore from — that is the trade for
nothing ever leaving your device. Regular exports are the backup.

## The app will not update

**More → App → Check for updates**, then **Install and reload** if one is offered. If it
seems stuck, force-quit and reopen once; the new version installs on next launch.

## A question about why something works the way it does

Read [the decision records](docs/decisions/) first — there are 34, and most "why not
just…" questions are answered in one, with the alternatives that were rejected.

If the answer is not there, that is itself worth an issue.

## Something in the documentation is wrong

[The most valuable issue you can file](https://github.com/ashwinraghav/FreeForeverFitnessApp/issues/new?template=claim_is_wrong.yml).
This project makes a lot of checkable claims and cannot afford a false one.

## A security vulnerability

Do not open a public issue. See [SECURITY.md](SECURITY.md).
