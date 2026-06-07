# PRD: Claude Usage Dashboard

**Project Name:** claude-usage-dashboard  
**Type:** Local Web Application  
**Status:** Ready for Implementation  
**Date:** 2026-06-07

---

## 1. Problem Statement

Claude Code users (especially heavy users) lack good visibility into their token usage, activity patterns, and project consumption. Current tools are mostly CLI-based or lack polish. The goal is to create a beautiful, private, local dashboard that makes usage data pleasant and insightful to explore.

---

## 2. Goals

- Deliver a clean, modern, fast local web dashboard
- Show meaningful usage statistics from Claude Code logs
- 100% local and private (no data leaves the machine)
- Easy to maintain and extend
- Pleasant daily driver experience

---

## 3. MVP Scope (What we build first)

### Core Features (Priority Order)

1. **Total Tokens KPI** — Big prominent number showing lifetime tokens
2. **Daily Usage Chart** — Bar chart of tokens per day (last 30 days)
3. **Model Breakdown** — Donut/pie chart showing usage split by model
4. **Activity Heatmap** — Calendar-style heatmap (GitHub contribution style)
5. **Project Breakdown** — Simple list or bars showing usage per project
6. **Refresh Functionality** — Button to re-scan logs
7. **Clean Modern UI** — Dark theme, fast, responsive

---

## 4. Technical Architecture

- **Backend**: FastAPI (Python)
- **Frontend**: SvelteKit + TypeScript + Tailwind CSS
- **Data Source**: Local Claude Code JSONL logs (usually `~/.claude/`)
- **Caching**: SQLite (recommended for performance)
- **Charts**: Chart.js (simple and reliable)

---

## 5. Key Principles

- Privacy first (everything stays local)
- Spec-driven development
- Iterative and incremental building
- High code quality and clean architecture
- Beautiful but lightweight UI

---

## 6. Non-Functional Requirements

- Dashboard should load in under 2 seconds
- Log parsing should be reasonably fast even with months of history
- Clean separation between data layer and presentation
- Easy to add new visualizations later

---

**This PRD is the source of truth.** All implementation decisions should align with it.
