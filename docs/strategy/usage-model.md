# How the app is meant to be used — an open question

**Status: unresolved. This is a note, not a decision.**

Raised 2026-09-02 by the project owner: *"We need to have a clear plan on how best
to use this app."*

## The problem

The app has more in it than anyone can discover, and there is no story for how a
person is supposed to use it. This is not a documentation gap — writing a manual
for a phone app people use between sets is not the answer — it is a product gap.

The evidence is that the owner, who commissioned every one of these features, has
been repeatedly surprised by what is already on screen:

- The **progression engine** already renders a suggestion line above every
  exercise (`suggestionLine` in `ActiveWorkoutScreen`). It reads the last session
  and says "add 2.5kg", "go again", or "three misses — cut 10%". It had been
  running for days before anyone asked what it does.
- **Ghost values** silently pre-fill last session's numbers, which is the single
  thing that makes a repeat set one tap. Nothing on screen says so.
- The **made / missed / not-yet** state on each set exists almost entirely to
  feed that engine — a set where the reps were hit but the set was bad. Nobody
  had knowingly used it.
- **Progress photos**, **session history**, **recipes** and **custom foods** are
  all reachable, and all were asked about as though missing.

A feature nobody knows about is indistinguishable from one that was never built,
and costs more.

## What this is not

**Not a product tour.** Driftway, Shepherd, Intro.js and the rest add 30–50 KB,
fight the service worker, and produce a coach-mark carousel people tap through
without reading. Worse, it is the wrong shape here: the design context is one
hand, bad light, out of breath, interrupted every 90 seconds. A modal sequence is
precisely what CLAUDE.md forbids during a workout.

**Not the current More screen either.** The "How this works" prose there was a
fast patch for "I don't know where the app starts", and it reads as a tutorial
parked permanently in a navigation tab. It should go once something better
exists.

## The direction worth trying

**Empty states that teach, and nothing else.** The app already does this well in
places — *"Nothing logged yet. Add the first lift and the app will carry your last
numbers over next time."* That sentence is onboarding: it appears exactly when it
is relevant, explains a real mechanism, and never appears again once there is
data. Extending that pattern costs no bundle, no library, and no modal.

Open questions that need answering before this can be built:

1. **What is the intended session, start to finish?** Open Train, add a lift,
   log a set, rest, finish — is that it? If so the app should be shaped around
   that path and everything else should be secondary.
2. **What teaches ghosts?** They are the highest-leverage thing in the product
   and they are invisible by design. A first repeat set may deserve one line.
3. **What teaches the progression suggestion?** It is already there and reads as
   decoration. Whether it is advice or a prescription changes how it should look.
4. **Does made / missed survive?** See the analysis in the same conversation: a
   short set already produces "go again" from the rep count alone. The state
   only matters for "I hit the reps but it should not count."
5. **What is the first-run path now?** New users land on More, which is a
   compromise, not a decision.

## Why this is not urgent but is important

Nothing here is blocking. Everything works. But every feature added without a
usage model makes the next one harder to find, and the app is now past the point
where a person can discover it by poking. The importers, when they land, will
bring people who have five years of history and no idea what any of this does.
