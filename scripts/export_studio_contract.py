"""Repeatable OpenAPI export from the secure app, without secrets or a live database."""

import json
from pathlib import Path
from brain.platform.api import create_app
from brain.platform.database import Settings


def main() -> None:
    app = create_app(Settings("sqlite://", allow_sqlite_for_tests=True))
    path = Path("frontend/src/api/openapi.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    app.state.engine.dispose()


if __name__ == "__main__":
    main()
