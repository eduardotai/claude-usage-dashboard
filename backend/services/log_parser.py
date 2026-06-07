"""Discover and parse Claude Code JSONL logs.

Claude Code stores one JSONL file per session under ``~/.claude/projects``.
Each line is a JSON object; the ones we care about have ``type == "assistant"``
and carry a ``message.usage`` block with token counts plus ``message.model``.

This module is intentionally dependency-free and streams files line by line so
it stays fast even with months of history.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


# --- Configuration ---------------------------------------------------------

def get_logs_root() -> Path:
    """Return the directory that holds Claude Code session logs.

    Override with the ``CLAUDE_LOGS_DIR`` environment variable. By default we
    use ``~/.claude/projects`` which is the standard location on macOS, Linux
    and Windows.
    """
    override = os.environ.get("CLAUDE_LOGS_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".claude" / "projects"


# --- Parsed record ---------------------------------------------------------

@dataclass(frozen=True)
class UsageRecord:
    """A single assistant message's token usage."""

    timestamp: datetime
    model: str
    project: str
    session_id: str
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_creation_tokens
            + self.cache_read_tokens
        )


# --- Helpers ---------------------------------------------------------------

def _project_name(cwd: str | None) -> str:
    """Derive a friendly project name from a working-directory path."""
    if not cwd:
        return "unknown"
    # Handle both Windows and POSIX separators regardless of host OS.
    cleaned = cwd.replace("\\", "/").rstrip("/")
    name = cleaned.rsplit("/", 1)[-1]
    return name or "unknown"


def _parse_timestamp(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        # Logs use ISO 8601 with a trailing "Z" for UTC.
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _record_from_line(line: str) -> UsageRecord | None:
    line = line.strip()
    if not line or '"usage"' not in line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None

    if obj.get("type") != "assistant":
        return None

    message = obj.get("message") or {}
    usage = message.get("usage") or {}
    if not usage:
        return None

    ts = _parse_timestamp(obj.get("timestamp"))
    if ts is None:
        return None

    return UsageRecord(
        timestamp=ts,
        model=message.get("model") or "unknown",
        project=_project_name(obj.get("cwd")),
        session_id=obj.get("sessionId") or "unknown",
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
        cache_creation_tokens=int(usage.get("cache_creation_input_tokens") or 0),
        cache_read_tokens=int(usage.get("cache_read_input_tokens") or 0),
    )


# --- Public API ------------------------------------------------------------

def find_log_files(root: Path | None = None) -> list[Path]:
    """Return every ``*.jsonl`` session file under the logs root."""
    root = root or get_logs_root()
    if not root.exists():
        return []
    return sorted(root.rglob("*.jsonl"))


def iter_usage_records(root: Path | None = None) -> Iterator[UsageRecord]:
    """Yield a :class:`UsageRecord` for every assistant message with usage."""
    for path in find_log_files(root):
        try:
            with path.open("r", encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    record = _record_from_line(line)
                    if record is not None:
                        yield record
        except OSError:
            # A file may be locked/removed mid-scan; skip it gracefully.
            continue


def parse_all(root: Path | None = None) -> list[UsageRecord]:
    """Eagerly parse every usage record. Convenience wrapper."""
    return list(iter_usage_records(root))
