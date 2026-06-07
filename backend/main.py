"""Claude Usage Dashboard API.

A tiny, local-only FastAPI app that exposes aggregated usage statistics parsed
from Claude Code's JSONL logs. No data ever leaves the machine.
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from services import stats

app = FastAPI(title="Claude Usage Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # Local-only tool: allow any localhost/127.0.0.1 port (Vite may shift ports).
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "Claude Usage Dashboard API is running"}


@app.get("/api/stats/summary")
async def summary(
    start: str | None = None,
    end: str | None = None,
    project: str | None = None,
):
    return stats.get_summary(start, end, project)


@app.get("/api/stats/daily")
async def daily(
    days: int | None = Query(30, ge=1, le=730),
    start: str | None = None,
    end: str | None = None,
    project: str | None = None,
):
    return stats.get_daily(days, start, end, project)


@app.get("/api/stats/models")
async def models(
    start: str | None = None,
    end: str | None = None,
    project: str | None = None,
):
    return stats.get_models(start, end, project)


@app.get("/api/stats/projects")
async def projects(start: str | None = None, end: str | None = None):
    return stats.get_projects(start, end)


@app.get("/api/stats/heatmap")
async def heatmap(
    days: int = Query(365, ge=30, le=730),
    project: str | None = None,
):
    return stats.get_heatmap(days, project)


@app.post("/api/refresh")
async def refresh():
    """Re-scan the log files from disk and rebuild the in-memory cache."""
    count = stats.refresh()
    return {"status": "ok", "records": count, "generated_at": stats.generated_at()}
