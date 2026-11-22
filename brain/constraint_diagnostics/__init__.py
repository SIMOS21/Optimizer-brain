"""Offline, read-only constraint diagnostics independent of all business sectors."""

from .contracts import DiagnosticsReport
from .engine import diagnose, diagnose_model

__all__ = ["DiagnosticsReport", "diagnose", "diagnose_model"]
