"""Optional REST API. LLM clients may supply JSON but cannot bypass validation."""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .models import Scenario
from .optimizer import solve

app = FastAPI(title='Optimization Brain API', version='0.1.0')


class OptimizationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    scenario: dict
    time_limit_seconds: float = Field(default=20, gt=0, le=300)


@app.post('/optimize')
def optimize(req: OptimizationRequest):
    try:
        scenario = Scenario.from_dict(req.scenario)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    solution = solve(scenario, time_limit_seconds=req.time_limit_seconds)
    return solution.to_dict()


@app.get('/health')
def health():
    return {'status': 'ok', 'brain': 'milp-highs', 'llm_required': False}
