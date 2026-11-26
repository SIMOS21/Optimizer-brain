"""Deterministic comparison of verified immutable optimization artifacts."""

from .contracts import ComparisonReport
from .engine import ComparisonInput, compare_runs

__all__ = ["ComparisonInput", "ComparisonReport", "compare_runs"]
