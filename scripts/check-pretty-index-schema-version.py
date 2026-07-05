#!/usr/bin/env python3
"""Generator self-check: compare the ``schema_version`` in a
pretty-index.json file against the validator's ``CURRENT_SCHEMA_VERSION``.

Exits 0 on match, 1 on mismatch (with a GitHub Actions ``::error::``
annotation and a regeneration hint appended to ``$GITHUB_STEP_SUMMARY``
when the env var is set), 2 on usage, 4 when the file is missing, 6 on
parse / envelope errors.

Usage:
  scripts/check-pretty-index-schema-version.py <pretty-index.json>
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

_VALIDATOR = Path(__file__).resolve().parent / "validate-pretty-index.py"
_spec = importlib.util.spec_from_file_location("_validate_pretty_index", _VALIDATOR)
assert _spec and _spec.loader
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
CURRENT = _mod.CURRENT_SCHEMA_VERSION


def _append_summary(text: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)
    except OSError:
        pass


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write(
            "usage: check-pretty-index-schema-version.py <pretty-index.json>\n"
        )
        return 2
    p = Path(argv[1])
    if not p.exists():
        sys.stderr.write(f"check-pretty-index-schema-version: file not found: {p}\n")
        return 4
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"check-pretty-index-schema-version: cannot parse {p}: {exc}\n")
        return 6

    if isinstance(data, list):
        actual: object = 0
    elif isinstance(data, dict) and "schema_version" in data:
        actual = data["schema_version"]
    else:
        sys.stderr.write(
            "check-pretty-index-schema-version: unrecognized top-level shape "
            "(expected array or {schema_version, entries})\n"
        )
        return 6

    if actual == CURRENT:
        sys.stderr.write(
            f"check-pretty-index-schema-version: OK (schema_version={actual}, "
            f"validator CURRENT={CURRENT})\n"
        )
        return 0

    hint = (
        f"generator emitted schema_version={actual} but validator expects "
        f"CURRENT_SCHEMA_VERSION={CURRENT}; regenerate with "
        "`python3 scripts/migrate-pretty-index.py "
        f"{p} --in-place` "
        "(see docs/schema-drift-diff-test-hooks.md)"
    )
    sys.stderr.write(
        f"::error file={p}::pretty-index.json schema drift: {hint}\n"
    )
    _append_summary(
        "\n### ❌ pretty-index.json schema drift\n\n"
        f"- File: `{p}`\n"
        f"- Generator emitted: `schema_version={actual}`\n"
        f"- Validator expects: `schema_version={CURRENT}`\n\n"
        "**Fix:** regenerate the index using "
        f"`python3 scripts/migrate-pretty-index.py {p} --in-place`, "
        "or bump `CURRENT_SCHEMA_VERSION` in "
        "`scripts/validate-pretty-index.py` if the generator is ahead.\n"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
