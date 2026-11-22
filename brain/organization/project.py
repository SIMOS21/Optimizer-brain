"""Load independent JSON files strictly inside a project directory."""

import json
from pathlib import Path, PurePosixPath, PureWindowsPath

from brain.kernel.schema import _invalid_constant, _unique_object
from .schema import OrganizationModel, OrganizationProject


def _read(path: Path) -> object:
    if path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError("Fichier JSON au-delà de la limite locale de 10 MiB")
    return json.loads(
        path.read_text(encoding="utf-8"),
        parse_float=str,
        parse_constant=_invalid_constant,
        object_pairs_hook=_unique_object,
    )


def _inside(root: Path, relative: str) -> Path:
    posix = PurePosixPath(relative)
    windows = PureWindowsPath(relative)
    if (
        "\\" in relative
        or ":" in relative
        or posix.is_absolute()
        or windows.drive
        or ".." in posix.parts
        or posix.suffix != ".json"
    ):
        raise ValueError(f"Chemin JSON relatif non autorisé : {relative!r}")
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError("Référence de fichier hors du répertoire projet")
    return candidate


def load_organization_file(path: Path) -> OrganizationModel:
    raw = _read(path)
    if not isinstance(raw, dict) or "graph_file" not in raw:
        return OrganizationModel.model_validate(raw)
    project = OrganizationProject.model_validate(raw)
    root = path.resolve().parent
    files = [_inside(root, relative) for relative in project.fragment_files]
    if len(set(files)) != len(files):
        raise ValueError("Le même fichier de fragment est référencé plusieurs fois")
    header = project.model_dump(exclude={"graph_file", "fragment_files"})
    return OrganizationModel.model_validate(
        {
            **header,
            "graph": _read(_inside(root, project.graph_file)),
            "fragments": [_read(fragment_path) for fragment_path in files],
        }
    )
