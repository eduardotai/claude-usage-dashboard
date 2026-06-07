# CLAUDE.md — Instructions for Claude Code

This file contains rules and guidelines for working on the **claude-usage-dashboard** project.

## Core Principles

1. **Spec-Driven Development**
   - Always implement features based on a written spec.
   - If a spec doesn't exist for a feature, create one first in `specs/`.
   - Never implement something big without a clear spec.

2. **Quality over Speed**
   - Write clean, readable, well-structured code.
   - Prefer simple solutions over clever ones.
   - Keep components small and focused.

3. **Privacy & Local-First**
   - Everything must run locally.
   - Never add telemetry, external API calls, or tracking.
   - The app only reads files from the user's machine.

4. **Beautiful but Lightweight**
   - UI should feel modern and calm (dark theme by default).
   - Avoid heavy dependencies when possible.
   - Prioritize perceived performance.

## Tech Stack Rules

- **Backend**: FastAPI + Python
- **Frontend**: SvelteKit + TypeScript + Tailwind
- **State Management**: Use Svelte stores or simple props (avoid over-engineering)
- **Charts**: Chart.js is preferred for MVP (simple and reliable)
- **Styling**: Tailwind + minimal custom CSS

## Development Workflow

When asked to implement a feature:

1. Read the relevant spec in `specs/`
2. Read `PRD.md` to understand the bigger picture
3. Check existing code structure before writing new code
4. Implement in small, logical steps
5. Use clear naming and add light comments where helpful
6. Make sure the feature works end-to-end (backend + frontend)

## Code Style Preferences

- Use TypeScript strictly in the frontend
- Prefer composition over deep inheritance
- Keep API responses simple and flat when possible
- Use meaningful variable and function names
- Write self-documenting code

## Important Constraints

- Do **not** add authentication (this is a local tool)
- Do **not** make external network requests
- Keep the backend as lightweight as possible
- The user may run this on a Mac — respect macOS paths

## Communication Style

When working on this project:
- Be direct and clear
- Propose small, testable increments
- Ask for clarification when a spec is ambiguous
- Suggest improvements only when they clearly align with the PRD

## File Organization

- Keep backend logic in `backend/services/`
- Keep API routes clean in `backend/main.py`
- Frontend components should be small and reusable
- Put complex logic in services/stores, not directly in components

Follow these rules strictly. They exist to make the project maintainable and pleasant to work on long-term.
