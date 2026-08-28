# Licensing

This repository is deliberately split-licensed. See [ADR-0003](docs/decisions/0003-licence.md).

| Path | Licence | Why |
|---|---|---|
| `apps/**` | AGPL-3.0-or-later | The application itself. Anyone who hosts a modified version must publish their source. This is the anti-enclosure protection for a project whose whole thesis is that this stays free. |
| `functions/**` | AGPL-3.0-or-later | Server-side code, same reasoning. |
| `packages/design-system` | Apache-2.0 | Meant to be reused. No reason to restrict it. |
| `packages/core` | Apache-2.0 | Pure domain logic (progression, TDEE, e1RM, plate maths). Useful to everyone; reuse is a win. |
| `packages/data` | AGPL-3.0-or-later | Couples tightly to the app's sync model. |
| `packages/datasets` | Mixed — see `packages/datasets/NOTICE.md` | Upstream data licences govern: USDA FoodData Central is public domain, Open Food Facts is ODbL (attribution + share-alike), free-exercise-db is public domain. Our build pipeline code is Apache-2.0. |

The root `LICENSE` file is AGPL-3.0. A package containing its own `LICENSE` file is governed by that file instead.

## Contributions

Contributions are accepted under the [Developer Certificate of Origin](https://developercertificate.org/) —
sign off commits with `git commit -s`. There is no CLA and no copyright assignment.

Note the consequence, stated plainly: because contributors retain copyright and there is no CLA,
the project **cannot** later be relicensed or dual-licensed without every contributor's agreement.
That is intentional. It means nobody — including the original author — can quietly take this proprietary.
