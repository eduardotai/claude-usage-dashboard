# Spec 002: Total Tokens KPI + Daily Usage Chart

## Goal
Display the most important information: total tokens used and a daily usage trend.

## Acceptance Criteria
- [ ] Big, prominent "Total Tokens" number on the dashboard
- [ ] Bar chart showing tokens used per day for the last 30 days
- [ ] Data comes from real (or dummy) log parsing
- [ ] Clean loading states
- [ ] Responsive and looks good on desktop

## Data Requirements
The backend should return:
- `total_tokens`: number
- `daily`: array of `{ date: string, tokens: number }`

## UI Notes
- Use a large, bold number for Total Tokens
- Bar chart should be clear and calm (not too colorful)
- Add a refresh button that re-fetches data

## Priority
P0 — Core of the MVP
