# Strategy

Public by design (ADR-0002). These documents are the reasoning behind the product, not marketing.

| Document | What it covers |
|---|---|
| [`business-plan.md`](business-plan.md) | Market analysis, the full paywall teardown, unit economics, the coach strategy, and what pays for "free". |
| [`execution-plan.md`](execution-plan.md) | The Blueprint design system, stack decisions, repository layout, the open-source secrets policy, and the team structure. |
| [`costs/`](costs/) | Monthly cloud bills, published (ADR-0020). |
| [`usage-model.md`](usage-model.md) | **Open question.** How the app is meant to be used, and why nobody can currently tell. |

## The finding, in one paragraph

The fitness app industry charges $24–480/year for a bundle whose software half costs roughly
$0.03–0.12 per user per month to operate. Three things are genuinely expensive — paid humans,
hosted video, and unmetered AI — and none of them are what most people open the app for. Build
everything else and give it away without limits; meter the AI so hard it can never surprise us;
broker the human layer through coaches instead of paying for it. Charge the supply side, never
the demand side, and only once free is already sustainable without that money.
