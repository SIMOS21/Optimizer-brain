"""Local-only CLI; no solver or network dependency."""

import argparse
import json
from pathlib import Path
import sys

from pydantic import ValidationError

from .compiler import ModelCompilationError, compile_model
from .ir import to_data
from .schema import ModelDSL, _invalid_constant, _unique_object, load_model_json
from .verification import verify_plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="DSL v1 : validation, IR et vérification d'un plan"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("model", type=Path)
    validate.add_argument("--output", type=Path)
    verify = commands.add_parser("verify")
    verify.add_argument("model", type=Path)
    verify.add_argument("--plan", type=Path, required=True)
    verify.add_argument("--output", type=Path)
    schema = commands.add_parser("schema")
    schema.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    exit_code = 0
    result: object
    try:
        if args.command == "schema":
            result = ModelDSL.model_json_schema()
        else:
            model = compile_model(load_model_json(args.model.read_text(encoding="utf-8")))
            if args.command == "verify":
                plan = json.loads(
                    args.plan.read_text(encoding="utf-8"),
                    parse_float=str,
                    parse_constant=_invalid_constant,
                    object_pairs_hook=_unique_object,
                )
                if not isinstance(plan, dict):
                    raise ValueError("Plan : objet JSON attendu")
                report = verify_plan(model, plan)
                result = to_data(report)
                exit_code = 0 if report.feasible else 1
            else:
                result = to_data(model)
        output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(output, encoding="utf-8")
        else:
            print(output, end="")
        return exit_code
    except (ValidationError, ModelCompilationError, ValueError, OSError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
