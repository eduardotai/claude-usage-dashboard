# Spec 004: Cost Estimation

## Goal
Show an *estimated* API-equivalent dollar cost for usage, so the user can sense
the monetary weight of their token consumption.

## Important Framing
Claude Code subscription billing is NOT per-token. This figure is an estimate of
what the same tokens would cost on the Anthropic API, for perspective only. The
UI must label it as "estimated" and note it is not a bill.

## Pricing (USD per 1M tokens)
| Model        | Input | Output | Cache write (5m) | Cache read |
|--------------|-------|--------|------------------|------------|
| Opus 4.x     | 5.00  | 25.00  | 6.25             | 0.50       |
| Sonnet 4.x   | 3.00  | 15.00  | 3.75             | 0.30       |
| Haiku 4.x    | 1.00  | 5.00   | 1.25             | 0.10       |

- Cache *creation* tokens are priced at the 5-minute write rate (1.25× input).
- Cache *read* tokens at 0.10× input.
- Unknown models fall back to Sonnet rates and are flagged.

## Acceptance Criteria
- [ ] Backend computes estimated cost per record and exposes:
      total cost (range-aware) in summary, per-model cost, per-project cost
- [ ] A prominent "Estimated cost" KPI for the selected range
- [ ] Cost shown alongside each model and (optionally) each project
- [ ] A clear "estimate, not a bill" note near the figure

## Priority
P1
