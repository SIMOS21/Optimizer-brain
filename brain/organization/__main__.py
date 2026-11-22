"""CLI for composition, one global solve, and local snapshot replay."""

import argparse
import json
from pathlib import Path
import sqlite3
import sys

from brain.solvers.contracts import SolveSettings
from .composition import compose_organization_model
from .project import load_organization_file
from .reporting import graph_mermaid
from .runtime import solve_organization
from .storage import SnapshotStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Phase 3 : graphe + fragments -> modèle global")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("compose", "solve"):
        command = commands.add_parser(name)
        command.add_argument("project", type=Path)
        command.add_argument("--store", type=Path)
        command.add_argument("--output", type=Path)
        command.add_argument("--mermaid", type=Path)
        if name == "solve":
            command.add_argument("--time-limit", type=float, default=20.0)
    replay = commands.add_parser("replay")
    replay.add_argument("--store", type=Path, required=True)
    replay.add_argument("--organization", required=True)
    replay.add_argument("--model", required=True)
    replay.add_argument("--version", required=True)
    replay.add_argument("--output", type=Path)
    replay.add_argument("--mermaid", type=Path)
    args = parser.parse_args(argv)
    code = 0
    try:
        if args.command == "replay":
            composition = SnapshotStore(args.store).load_snapshot(
                args.organization, args.model, args.version
            )
            output = composition.to_dict()
        else:
            source = load_organization_file(args.project)
            if args.command == "solve":
                run = solve_organization(source, SolveSettings(time_limit_seconds=args.time_limit))
                composition, output = run.composition, run.to_dict()
                code = (
                    0
                    if run.report.has_verified_plan
                    else (
                        2
                        if run.solve.status
                        in ("INVALID_MODEL", "ERROR", "SOLUTION_FAILED_VALIDATION")
                        else 1
                    )
                )
                if args.store:
                    SnapshotStore(args.store).publish(composition, run)
            else:
                composition = compose_organization_model(source)
                output = composition.to_dict()
                if args.store:
                    SnapshotStore(args.store).publish(composition)
        if args.mermaid:
            args.mermaid.write_text(graph_mermaid(composition), encoding="utf-8")
        text = json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        if args.output:
            args.output.write_text(text, encoding="utf-8")
        else:
            print(text, end="")
        return code
    except (ValueError, KeyError, OSError, sqlite3.Error) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
