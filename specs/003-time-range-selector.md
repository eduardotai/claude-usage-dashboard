# Spec 003: Time Range Selector

## Goal
Let the user scope the whole dashboard to a time window (7D / 30D / 90D / All)
so trends, totals, and breakdowns can be examined over different horizons.

## Acceptance Criteria
- [ ] A segmented control with options: 7D, 30D, 90D, All
- [ ] Selecting a range re-fetches and updates: hero total + breakdown, KPI cards,
      daily chart, model donut, project list, and estimated cost
- [ ] The daily chart's window matches the selected range (All → since first log)
- [ ] The activity heatmap always shows the trailing year, clearly labeled
      ("The last year") — it is intentionally independent of the selector
- [ ] Range changes feel instant (data already cached server-side)

## Data Requirements
Stats endpoints accept optional `start` and `end` (ISO `yyyy-mm-dd`, inclusive):
- `/api/stats/summary?start&end`
- `/api/stats/daily?start&end` (or `days`)
- `/api/stats/models?start&end`
- `/api/stats/projects?start&end`

The backend filters parsed records by local-date range, then aggregates.

## UI Notes
- Default range: 30D
- Label the hero total with the active range ("last 30 days" / "all time")

## Priority
P1
