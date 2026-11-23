"""Closed public error codes; never echo user-controlled content in the UI."""

from typing import Literal

from brain.kernel.schema import StrictModel
from .service import ServiceError

Code = Literal[
    "UNIT_CHANGE_FORBIDDEN",
    "CHANGE_NOT_DELEGATED",
    "CHANGE_OUT_OF_RANGE",
    "INTEGER_REQUIRED",
    "RULE_NOT_ALLOWED",
    "POLICY_NOT_PUBLISHED",
    "POLICY_AUTHORITY_REVOKED",
    "PREVIEW_CHANGED",
]


class ChangeError(ServiceError):
    def __init__(self, status: int, code: Code) -> None:
        super().__init__(status, code)
        self.code = code


class ChangeErrorDetail(StrictModel):
    code: Code


class ChangeErrorResponse(StrictModel):
    detail: ChangeErrorDetail | str | list[object]
