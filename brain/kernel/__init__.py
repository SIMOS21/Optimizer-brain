"""Universal Model Kernel: offline DSL, compiler, IR and plan interpreter."""

from .compiler import ModelCompilationError, compile_model
from .ir import OptimizationIR
from .schema import ModelDSL, load_model_json
from .verification import verify_plan

__all__ = [
    "ModelCompilationError",
    "ModelDSL",
    "OptimizationIR",
    "compile_model",
    "load_model_json",
    "verify_plan",
]
