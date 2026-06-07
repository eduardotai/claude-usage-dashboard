# Spec 005: Per-Project Drill-Down

## Goal
Let the user click a project to filter the entire dashboard to just that
project's usage, then clear the filter to return to the global view.

## Acceptance Criteria
- [ ] Clicking a project in the breakdown filters the whole dashboard
      (hero, KPIs, daily chart, model donut, cost) to that project
- [ ] A visible "filtered by <project>" chip with a clear (✕) action
- [ ] The selected project is highlighted in the project list
- [ ] Clearing returns to the all-projects view
- [ ] The time-range selector composes with the project filter

## Data Requirements
Stats endpoints accept an optional `project` query param:
- `/api/stats/summary?project=`
- `/api/stats/daily?project=`
- `/api/stats/models?project=`
The backend filters records by project name, then aggregates.

## UI Notes
- The heatmap may remain global (trailing year, all projects) for context.
- Keep the project list visible while filtered so the user can switch projects.

## Priority
P1
