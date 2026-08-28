# Long-tail food search — endpoint contract

**Status: contract only. Nothing here is implemented. This document defines what
the Cloud Run service must do so that the client can be built against it and so
the cost ceiling is designed in rather than discovered.**

The local index holds roughly the top 100,000 foods (ADR-0006). This endpoint
serves everything else: an unrecognised barcode, a regional product, a
misspelling the local index cannot forgive.

## The constraints this contract exists to satisfy

- **Constitution rule 2 — no unbounded per-user cost.** The ceiling ships with
  the feature, in the same PR. Not a monitoring alert.
- **Constitution rule 1 — every feature has a zero-cost path.** If this endpoint
  is down, over budget, or the user is offline, food search still works against
  the local index and manual entry still works. The endpoint is an enhancement
  that degrades; it is never the only way to log a meal.
- **ADR-0006 — the local index answers the large majority of searches.** If this
  endpoint's hit rate climbs, that is a signal the index needs rebalancing, not
  a signal to scale the service.

## Request

```http
GET /v1/foods/search?q=<query>&limit=<n>&region=<iso2>
GET /v1/foods/barcode/<gtin>
```

| Parameter | Type | Notes |
|---|---|---|
| `q` | string, 2–64 chars | the raw user query; the server folds it the same way `fold()` does |
| `limit` | int, 1–25, default 10 | |
| `region` | ISO 3166-1 alpha-2, optional | biases ranking; never filters |
| `gtin` | 8–14 digits | leading zeros significant |

Headers:

| Header | Required | Purpose |
|---|---|---|
| `X-Index-Version` | yes | the client's local index version, e.g. `2026.08.1` |
| `X-App-Check` | yes | Firebase App Check token — the abuse ceiling; an unattested request is rejected before it costs anything |
| `Accept-Encoding: gzip` | yes | responses are small but always compressed |

**No user identifier of any kind.** Not a uid, not a device id, not a
session token. The server must be unable to build a picture of what any
individual eats even if it wanted to, and App Check attests the *app*, not the
person. This is a design constraint, not a privacy policy: constitution rule 6.

## Response

`200 OK`

```json
{
  "indexVersion": "2026.08.1",
  "results": [
    {
      "sourceId": "3017620422003",
      "source": "off",
      "licence": "ODbL-1.0",
      "attributionUrl": "https://world.openfoodfacts.org/product/3017620422003",
      "name": "Nutella",
      "brand": "Ferrero",
      "barcode": "3017620422003",
      "basis": "g",
      "per100": {
        "kcal": 539, "proteinG": 6.3, "carbG": 57.5, "fatG": 30.9,
        "fibreG": 0, "sugarG": 56.3, "sodiumMg": 42, "satFatG": 10.6
      },
      "servingGrams": 15,
      "servingLabel": "1 tbsp",
      "flags": {
        "servingEstimated": false,
        "atwaterMismatch": false,
        "highConfidence": true,
        "energyReported": true
      }
    }
  ],
  "cache": { "maxAgeSeconds": 2592000, "etag": "\"a1b2c3\"" }
}
```

**The `results[]` element is byte-for-byte the shape of a local `Food`**, minus
`id` and `shard`, which the client assigns. That is deliberate: the client
merges local and remote results into one list, and a second shape would mean a
second rendering path and a second set of bugs.

Errors are always JSON, never an empty 200:

| Status | Meaning | Client behaviour |
|---|---|---|
| `400` | malformed query | show nothing; this is a client bug |
| `401` | App Check failed | fall back to local-only, silently |
| `404` | barcode lookup found nothing | offer manual entry, and offer to contribute (see `contribution-loop.md`) |
| `429` | over the caller's rate ceiling | fall back to local-only, silently, and back off |
| `503` | over the global daily budget | fall back to local-only, silently |

**`429` and `503` are normal operating states, not incidents.** They are how the
cost ceiling is enforced. The client must render them as "no extra results",
never as an error. A user mid-workout must not learn that a budget exists.

## Caching: fetched once, never twice

This is the part that makes the endpoint affordable, so it is specified rather
than left to the client.

1. **Every result the user acts on is written to the local long-tail cache**
   (IndexedDB, a store separate from both shards and from the user's own foods).
   Keyed on `${source}:${sourceId}`, with a secondary index on `barcode`.
2. **Every lookup checks, in order:** the local shards → the long-tail cache →
   the network. The network is reached only on a miss in both.
3. **A cached entry never expires on a timer.** Nutrition data for a specific
   product barcode does not change; when a manufacturer reformulates, the
   barcode changes. Entries are refreshed only when the user pulls to refresh a
   food's detail view, or when a new index version supersedes the record.
4. **Negative results are cached too**, for 7 days, keyed on the normalised
   query or barcode. A barcode that is not in the database will be scanned
   again by the same user, and the second scan must not cost a request.
5. **A new local index version prunes the cache**: on upgrade, drop any cached
   entry whose `${source}:${sourceId}` now appears in a shard. The index has
   absorbed it.
6. **Cache entries carry their licence.** An OFF-sourced cache entry is
   ODbL-covered like the shard it would have come from. Because the cache is
   per-device and never published, no further obligation arises — but the
   `licence` and `attributionUrl` fields travel with the record so the detail
   view can credit it. See `../NOTICE.md` §2.4.

The client must debounce: no network request until 400 ms after the last
keystroke, and never while the local index is still returning results.

## The cost ceiling, which ships with the endpoint

| Ceiling | Value | Enforced by |
|---|---|---|
| Per-App-Check-token | 60 requests/hour | in-process token bucket, no state store |
| Global daily | a fixed request count, set from the monthly budget in `docs/strategy/costs/` | a daily counter; `503` past it |
| Cloud Run max instances | a hard cap, not autoscaled to demand | Terraform |
| Response size | 25 results max, ~8 KB gzipped | schema |

Cloud Run scale-to-zero means idle cost is zero. The upstream data is a
pre-built index in the container image or in Cloud Storage — **not** a per-call
third-party API, which constitution rule 5 forbids on a path users touch daily.

## Notes for whoever implements this

- Serve from our own derived data. Proxying the Open Food Facts API per query
  would be rule 5 all over again, and would put our traffic on a charity's
  servers.
- The server-side index can afford what the client cannot: spelling correction,
  substring matching, a much larger corpus. That asymmetry is the point — it is
  why the 3x trigram structure was rejected for the client and belongs here.
- Log query text **never**, aggregate hit/miss counts only. A miss rate by
  region is the signal worth having, and it needs no query text to compute.
- The `X-Index-Version` header lets the server skip results the client already
  has locally. Worth doing: it cuts response size and stops the merge producing
  duplicates.
