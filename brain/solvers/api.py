"""Synchronous development-only DSL routes, alongside the unchanged legacy API."""

from decimal import Decimal
import json
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import Field
from starlette.responses import Response

from brain.kernel import ModelCompilationError, ModelDSL, compile_model
from brain.kernel.ir import to_data
from brain.kernel.schema import StrictModel, _invalid_constant, _unique_object
from .contracts import SolveSettings
from .highs import HighsAdapter
from .orchestrator import SolverOrchestrator


class _PreciseJSONRequest(Request):
    async def json(self) -> Any:
        return json.loads(
            await self.body(),
            parse_float=Decimal,
            parse_constant=_invalid_constant,
            object_pairs_hook=_unique_object,
        )


class _PreciseJSONRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            precise = _PreciseJSONRequest(request.scope, request.receive)
            try:
                await precise.json()
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            try:
                return await original(precise)
            except RequestValidationError as exc:
                detail = [
                    {key: error[key] for key in ("loc", "type", "msg")} for error in exc.errors()
                ]
                raise HTTPException(status_code=422, detail=detail) from exc

        return handler


router = APIRouter(
    prefix="/api/v1/models",
    tags=["Generic optimization (local development)"],
    route_class=_PreciseJSONRoute,
)


class ValidationRequest(StrictModel):
    model: ModelDSL


class SolveRequest(ValidationRequest):
    settings: SolveSettings = Field(default_factory=SolveSettings)


@router.post("/validate")
def validate_model(body: ValidationRequest) -> object:
    try:
        model = compile_model(body.model)
        support = HighsAdapter().supports(model)
        if not support.supported:
            raise HTTPException(
                status_code=422, detail={"status": "INVALID_MODEL", "issues": support.issues}
            )
        return {"valid": True, "ir": to_data(model), "support": to_data(support)}
    except ModelCompilationError as exc:
        raise HTTPException(status_code=422, detail=to_data(exc.issues)) from exc


@router.post("/solve")
async def solve_model(body: SolveRequest) -> object:
    # Run CPU/native work outside the async event loop. No jobs/worker lifecycle yet.
    from starlette.concurrency import run_in_threadpool

    result = await run_in_threadpool(SolverOrchestrator().run, body.model, body.settings)
    if result.status == "INVALID_MODEL":
        raise HTTPException(status_code=422, detail=result.to_dict())
    return result.to_dict()
