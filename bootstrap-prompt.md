# Bootstrap Prompt for Claude Code

Copy and paste the entire content below into Claude Code to initialize the full project.

---

You are an expert full-stack developer. I want you to bootstrap a complete local web application called **Claude Usage Dashboard**.

## Project Goal
Build a beautiful, private, local-first dashboard that visualizes Claude Code usage data from local log files.

## Tech Stack (Fixed)
- Backend: FastAPI (Python)
- Frontend: SvelteKit + TypeScript + Tailwind CSS
- Charts: Chart.js
- Data source: Local Claude Code JSONL logs

## Rules (Very Important)
- Follow the instructions in `CLAUDE.md` strictly
- Follow the requirements in `PRD.md`
- Use spec-driven development
- Keep everything local and private
- Write clean, high-quality code

## Tasks — Do them in order:

### Phase 1: Project Structure
1. Create the full recommended folder structure:
   - `backend/`
   - `frontend/`
   - `specs/`
   - Root files: `PRD.md`, `CLAUDE.md`, `README.md`

2. Initialize a SvelteKit project inside the `frontend/` folder with TypeScript and Tailwind.

3. Create a basic FastAPI backend in `backend/main.py` with:
   - One health check endpoint `/api/health`
   - CORS enabled for localhost development

4. Create a `backend/requirements.txt` with at least: `fastapi`, `uvicorn`, `python-dotenv`

### Phase 2: Basic Data Layer
5. Create `backend/services/log_parser.py`
   - Add a function that can detect and read Claude Code JSONL logs
   - Start by supporting the most common location (`~/.claude/`)
   - Make the log path configurable via environment variable or simple config

6. Create a basic parser that can extract:
   - Timestamp
   - Model used
   - Token count (input + output if available)
   - Project/folder name (if detectable)

### Phase 3: First API Endpoints
7. In `backend/main.py`, create these endpoints:
   - `GET /api/stats/summary` → Returns total tokens + basic KPIs
   - `GET /api/stats/daily` → Returns daily token usage for the last 30 days
   - `GET /api/stats/models` → Returns breakdown by model

8. Make the backend return realistic dummy data first so the frontend can be developed in parallel.

### Phase 4: Frontend Foundation
9. In the SvelteKit frontend:
   - Set up Tailwind properly
   - Create a clean dark theme layout
   - Create a dashboard page with:
     - Top navigation
     - KPI cards section
     - Placeholder areas for charts

10. Connect the frontend to the backend (use `localhost:8000` during development)

### Phase 5: Documentation
11. Update `README.md` with clear setup instructions for both backend and frontend.

---

After you finish the bootstrap, give me a summary of what was created and the next recommended feature to implement from the `specs/` folder.

Start now.
