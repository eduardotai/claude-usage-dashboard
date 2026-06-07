"""Estimated API-equivalent pricing for Claude models.

Claude Code subscription billing is NOT per-token. These rates estimate what the
same tokens would cost on the Anthropic API, purely for perspective. Rates are
USD per 1,000,000 tokens. Cache *creation* is billed at the 5-minute write rate
(1.25x input); cache *reads* at 0.10x input.
"""

from __future__ import annotations

from .log_parser import UsageRecord

# Per-family rates: (input, output, cache_write_5m, cache_read) per 1M tokens.
_RATES = {
    "opus": (5.00, 25.00, 6.25, 0.50),
    "sonnet": (3.00, 15.00, 3.75, 0.30),
    "haiku": (1.00, 5.00, 1.25, 0.10),
}
_FALLBACK = _RATES["sonnet"]  # used for unrecognized models


def rates_for(model: str) -> tuple[float, float, float, float]:
    m = model.lower()
    if "opus" in m:
        return _RATES["opus"]
    if "sonnet" in m:
        return _RATES["sonnet"]
    if "haiku" in m:
        return _RATES["haiku"]
    return _FALLBACK


def cost_of(record: UsageRecord) -> float:
    """Estimated USD cost of a single usage record."""
    inp, out, cwrite, cread = rates_for(record.model)
    return (
        record.input_tokens * inp
        + record.output_tokens * out
        + record.cache_creation_tokens * cwrite
        + record.cache_read_tokens * cread
    ) / 1_000_000
