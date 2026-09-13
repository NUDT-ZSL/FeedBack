"""Deterministic pseudo-random source (xorshift64*).

The consensus core must never touch ``random``'s global state or ``time``;
all randomness flows through this class so that a fixed seed plus a fixed
event sequence replays byte-for-byte.
"""
from __future__ import annotations

_MASK64 = (1 << 64) - 1


class DeterministicRandom:
    """A tiny self-contained PRNG. Same seed => same stream, always."""

    def __init__(self, seed: int):
        if not isinstance(seed, int):
            raise TypeError(f"seed must be an int, got {type(seed).__name__}")
        # Mix the seed so seed=0 does not start at the all-zero fixed point.
        state = (seed ^ 0x9E3779B97F4A7C15) & _MASK64
        self._state = state or 0x2545F4914F6CDD1D

    @property
    def state(self) -> int:
        return self._state

    def _next(self) -> int:
        x = self._state
        x ^= (x >> 12)
        x ^= (x << 25) & _MASK64
        x ^= (x >> 27)
        self._state = x & _MASK64
        return (x * 0x2545F4914F6CDD1D) & _MASK64

    def randint(self, lo: int, hi: int) -> int:
        """Uniform integer in [lo, hi] (both inclusive)."""
        if lo > hi:
            raise ValueError(f"empty range: lo={lo} > hi={hi}")
        span = hi - lo + 1
        return lo + self._next() % span
