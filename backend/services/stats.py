"""Aggregate parsed usage records into dashboard-ready statistics.

Records are parsed once and held in a small in-memory cache. Every endpoint
reads from that cache and applies optional filters (date range, project) before
aggregating, so a page load processes ~10k records in memory (microseconds)
rather than re-reading hundreds of files. Call :func:`refresh` to re-scan disk.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from threading import Lock

from .log_parser import UsageRecord, parse_all
from .pricing import cost_of

# --- In-memory cache -------------------------------------------------------

_lock = Lock()
_records: list[UsageRecord] | None = None
_generated_at: datetime | None = None


def _local_date(rec: UsageRecord) -> date:
    """Bucket a record by the user's local calendar day."""
    return rec.timestamp.astimezone().date()


def _ensure_loaded() -> list[UsageRecord]:
    global _records, _generated_at
    with _lock:
        if _records is None:
            # Drop synthetic / zero-token noise; it isn't real usage.
            _records = [r for r in parse_all() if r.total_tokens > 0]
            _generated_at = datetime.now().astimezone()
        return _records


def refresh() -> int:
    """Re-scan logs from disk. Returns the number of usage records found."""
    global _records, _generated_at
    with _lock:
        _records = [r for r in parse_all() if r.total_tokens > 0]
        _generated_at = datetime.now().astimezone()
        return len(_records)


def generated_at() -> str | None:
    return _generated_at.isoformat() if _generated_at else None


# --- Filtering -------------------------------------------------------------

def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _filtered(
    start: str | None = None,
    end: str | None = None,
    project: str | None = None,
) -> list[UsageRecord]:
    """Return cached records narrowed by date range and/or project."""
    records = _ensure_loaded()
    start_d = _parse_date(start)
    end_d = _parse_date(end)
    if start_d is None and end_d is None and not project:
        return records

    out = []
    for r in records:
        if project and r.project != project:
            continue
        if start_d or end_d:
            d = _local_date(r)
            if start_d and d < start_d:
                continue
            if end_d and d > end_d:
                continue
        out.append(r)
    return out


# --- Aggregations ----------------------------------------------------------

def get_summary(
    start: str | None = None, end: str | None = None, project: str | None = None
) -> dict:
    records = _filtered(start, end, project)

    totals = {"input": 0, "output": 0, "cache_creation": 0, "cache_read": 0}
    cost = 0.0
    sessions: set[str] = set()
    projects: set[str] = set()
    models: set[str] = set()
    dates: list[date] = []

    for r in records:
        totals["input"] += r.input_tokens
        totals["output"] += r.output_tokens
        totals["cache_creation"] += r.cache_creation_tokens
        totals["cache_read"] += r.cache_read_tokens
        cost += cost_of(r)
        sessions.add(r.session_id)
        projects.add(r.project)
        models.add(r.model)
        dates.append(_local_date(r))

    total_tokens = sum(totals.values())
    active_days = len(set(dates))
    return {
        "total_tokens": total_tokens,
        "breakdown": totals,
        "estimated_cost": round(cost, 2),
        "total_messages": len(records),
        "total_sessions": len(sessions),
        "total_projects": len(projects),
        "total_models": len(models),
        "active_days": active_days,
        "avg_tokens_per_active_day": round(total_tokens / active_days) if active_days else 0,
        "first_date": min(dates).isoformat() if dates else None,
        "last_date": max(dates).isoformat() if dates else None,
        "generated_at": generated_at(),
    }


def get_daily(
    days: int | None = 30,
    start: str | None = None,
    end: str | None = None,
    project: str | None = None,
) -> dict:
    """Token usage per day (gaps filled with zero).

    If ``start``/``end`` are given they define the window; otherwise the trailing
    ``days`` days are used. When the window is open-ended, it spans the available
    data.
    """
    records = _filtered(start, end, project)
    today = date.today()

    start_d = _parse_date(start)
    end_d = _parse_date(end) or today
    if start_d is None:
        if days:
            start_d = end_d - timedelta(days=days - 1)
        else:
            dates = [_local_date(r) for r in records]
            start_d = min(dates) if dates else end_d

    buckets: dict[date, dict[str, int]] = defaultdict(
        lambda: {"tokens": 0, "input": 0, "output": 0, "cache": 0}
    )
    for r in records:
        d = _local_date(r)
        if d < start_d or d > end_d:
            continue
        b = buckets[d]
        b["tokens"] += r.total_tokens
        b["input"] += r.input_tokens
        b["output"] += r.output_tokens
        b["cache"] += r.cache_creation_tokens + r.cache_read_tokens

    span = (end_d - start_d).days + 1
    series = []
    for i in range(max(span, 0)):
        d = start_d + timedelta(days=i)
        b = buckets.get(d, {"tokens": 0, "input": 0, "output": 0, "cache": 0})
        series.append({"date": d.isoformat(), **b})

    return {"start": start_d.isoformat(), "end": end_d.isoformat(), "daily": series}


def get_models(
    start: str | None = None, end: str | None = None, project: str | None = None
) -> dict:
    records = _filtered(start, end, project)
    agg: dict[str, dict[str, float]] = defaultdict(
        lambda: {"tokens": 0, "messages": 0, "cost": 0.0}
    )
    for r in records:
        a = agg[r.model]
        a["tokens"] += r.total_tokens
        a["messages"] += 1
        a["cost"] += cost_of(r)

    total = sum(a["tokens"] for a in agg.values()) or 1
    models = [
        {
            "model": model,
            "tokens": int(a["tokens"]),
            "messages": int(a["messages"]),
            "cost": round(a["cost"], 2),
            "share": round(a["tokens"] / total, 4),
        }
        for model, a in agg.items()
    ]
    models.sort(key=lambda m: m["tokens"], reverse=True)
    return {"models": models}


def get_projects(
    start: str | None = None, end: str | None = None
) -> dict:
    records = _filtered(start, end, None)
    agg: dict[str, dict] = defaultdict(
        lambda: {"tokens": 0, "messages": 0, "cost": 0.0, "sessions": set()}
    )
    for r in records:
        a = agg[r.project]
        a["tokens"] += r.total_tokens
        a["messages"] += 1
        a["cost"] += cost_of(r)
        a["sessions"].add(r.session_id)

    total = sum(a["tokens"] for a in agg.values()) or 1
    projects = [
        {
            "project": project,
            "tokens": int(a["tokens"]),
            "messages": int(a["messages"]),
            "cost": round(a["cost"], 2),
            "sessions": len(a["sessions"]),
            "share": round(a["tokens"] / total, 4),
        }
        for project, a in agg.items()
    ]
    projects.sort(key=lambda p: p["tokens"], reverse=True)
    return {"projects": projects}


def get_heatmap(days: int = 365, project: str | None = None) -> dict:
    """Calendar heatmap data: tokens + message count per day for the window."""
    records = _filtered(None, None, project)
    today = date.today()
    start = today - timedelta(days=days - 1)

    buckets: dict[date, dict[str, int]] = defaultdict(lambda: {"tokens": 0, "count": 0})
    for r in records:
        d = _local_date(r)
        if d < start:
            continue
        b = buckets[d]
        b["tokens"] += r.total_tokens
        b["count"] += 1

    cells = [
        {"date": d.isoformat(), "tokens": b["tokens"], "count": b["count"]}
        for d, b in sorted(buckets.items())
    ]
    max_tokens = max((b["tokens"] for b in buckets.values()), default=0)
    return {
        "start": start.isoformat(),
        "end": today.isoformat(),
        "max_tokens": max_tokens,
        "cells": cells,
    }
