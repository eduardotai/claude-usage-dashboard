"""Generate synthetic Claude Code session logs for demos and screenshots.

Produces JSONL files in the same shape the real parser reads
(`type: "assistant"` records with `message.usage` + `message.model` + `cwd`),
using fictional project names and randomized-but-realistic token counts. Point
the backend at the output with the CLAUDE_LOGS_DIR environment variable:

    python scripts/generate_sample_logs.py --out ./sample-logs
    CLAUDE_LOGS_DIR=./sample-logs uvicorn main:app --port 8000  # from backend/

Nothing here touches your real ~/.claude logs.
"""

from __future__ import annotations

import argparse
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Fictional projects with a rough "weight" controlling how much usage each gets.
PROJECTS = [
    ("acme-storefront", 5.0),
    ("ml-pipeline", 3.4),
    ("design-system", 2.1),
    ("api-gateway", 1.7),
    ("docs-site", 1.2),
    ("mobile-app", 1.0),
    ("infra-scripts", 0.6),
    ("playground", 0.35),
]

# Models with selection weights (Opus dominant, like typical heavy usage).
MODELS = [
    ("claude-opus-4-8", 0.74),
    ("claude-sonnet-4-6", 0.16),
    ("claude-haiku-4-5-20251001", 0.07),
    ("claude-opus-4-7", 0.03),
]


def weighted_choice(pairs):
    items, weights = zip(*pairs)
    return random.choices(items, weights=weights, k=1)[0]


def make_record(ts: datetime, project: str, session_id: str) -> dict:
    model = weighted_choice(MODELS)
    # Cache reads dominate real usage; scale others off a base size.
    base = random.randint(1, 6)
    return {
        "type": "assistant",
        "timestamp": ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "cwd": f"/home/demo/projects/{project}",
        "sessionId": session_id,
        "message": {
            "model": model,
            "usage": {
                "input_tokens": random.randint(800, 9000) * base,
                "output_tokens": random.randint(150, 2600) * base,
                "cache_creation_input_tokens": random.randint(0, 4000) * base,
                "cache_read_input_tokens": random.randint(4000, 90000) * base,
            },
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate synthetic Claude Code logs.")
    ap.add_argument("--out", default="./sample-logs", help="Output directory (logs root)")
    ap.add_argument("--days", type=int, default=42, help="How many days back to span")
    ap.add_argument("--seed", type=int, default=7, help="RNG seed for reproducibility")
    args = ap.parse_args()

    random.seed(args.seed)
    out = Path(args.out)
    today = datetime.now()

    total = 0
    for project, weight in PROJECTS:
        proj_dir = out / project
        proj_dir.mkdir(parents=True, exist_ok=True)
        # A few sessions per project across the window.
        n_sessions = max(2, round(weight * 4))
        for _ in range(n_sessions):
            session_id = str(uuid.uuid4())
            records = []
            # Each session spans a random recent day with a burst of messages.
            day_offset = random.randint(0, args.days - 1)
            day = today - timedelta(days=day_offset)
            n_msgs = max(3, round(random.gauss(40 * weight, 12)))
            for _ in range(n_msgs):
                ts = day.replace(
                    hour=random.randint(8, 23),
                    minute=random.randint(0, 59),
                    second=random.randint(0, 59),
                    microsecond=random.randint(0, 999000),
                )
                records.append(make_record(ts, project, session_id))
            records.sort(key=lambda r: r["timestamp"])
            path = proj_dir / f"{session_id}.jsonl"
            with path.open("w", encoding="utf-8") as fh:
                for r in records:
                    fh.write(json.dumps(r) + "\n")
            total += len(records)

    print(f"Wrote {total:,} synthetic records to {out.resolve()}")


if __name__ == "__main__":
    main()
