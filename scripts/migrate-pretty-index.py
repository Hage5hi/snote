#!/usr/bin/env python3
"""Migrate a pretty-index.json to the current schema version.

Accepts:
  * Legacy (v0) bare JSON array of entries.
  * Versioned (v>=1) envelope ``{"schema_version": N, "entries": [...]}``
    for any N in ``validate_pretty_index.SUPPORTED_SCHEMA_VERSIONS``.

Rewrites to the current envelope shape
``{"schema_version": CURRENT_SCHEMA_VERSION, "entries": [...]}`` and
prints a compact before/after summary to stderr:

    == pretty-index migration ==
    from: v0 (legacy array)     entries: 3
    to:   v1 (envelope)         entries: 3
    file: path/to/pretty-index.json (in-place)

Usage:
  scripts/migrate-pretty-index.py <path> [--in-place | --output <path>]
                                         [--dry-run]

Exit codes (share meaning with validate-pretty-index.py):
  0  migrated (or already current when --dry-run)
  2  usage
  4  file missing
  6  file exists but is not a recognized top-level shape / not JSON
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Import version constants from the sibling validator so the two scripts
# stay in lockstep automatically when CURRENT_SCHEMA_VERSION is bumped.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_pretty_index import (  # type: ignore  # noqa: E402
    CURRENT_SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS,
)


def _detect(data: object) -> tuple[int, list] | None:
    if isinstance(data, list):
        return 0, data
    if isinstance(data, dict) and isinstance(data.get("entries"), list):
        v = data.get("schema_version")
        if isinstance(v, int) and not isinstance(v, bool):
            return v, data["entries"]
    return None


def main(argv: list[str]) -> int:
    args = argv[1:]
    in_place = False
    dry_run = False
    output: str | None = None
    positional: list[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--in-place":
            in_place = True
        elif a == "--dry-run":
            dry_run = True
        elif a == "--output":
            i += 1
            if i >= len(args):
                sys.stderr.write("migrate-pretty-index: --output requires a path\n")
                return 2
            output = args[i]
        elif a in ("-h", "--help"):
            sys.stderr.write(__doc__ or "")
            return 2
        elif a.startswith("--"):
            sys.stderr.write(f"migrate-pretty-index: unknown flag: {a}\n")
            return 2
        else:
            positional.append(a)
        i += 1
    if len(positional) != 1:
        sys.stderr.write("usage: migrate-pretty-index.py <path> [--in-place|--output PATH] [--dry-run]\n")
        return 2
    if in_place and output:
        sys.stderr.write("migrate-pretty-index: --in-place and --output are mutually exclusive\n")
        return 2

    src = Path(positional[0])
    if not src.exists():
        sys.stderr.write(f"migrate-pretty-index: file not found: {src}\n")
        return 4
    try:
        data = json.loads(src.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"migrate-pretty-index: cannot parse {src}: {exc}\n")
        return 6

    detected = _detect(data)
    if detected is None:
        sys.stderr.write(
            "migrate-pretty-index: unrecognized top-level shape (expected array "
            "or {schema_version, entries})\n"
        )
        return 6
    from_version, entries = detected
    if from_version not in SUPPORTED_SCHEMA_VERSIONS:
        sys.stderr.write(
            f"migrate-pretty-index: schema_version={from_version} is not in "
            f"SUPPORTED_SCHEMA_VERSIONS={sorted(SUPPORTED_SCHEMA_VERSIONS)}; "
            "update this script before migrating.\n"
        )
        return 6

    migrated = {"schema_version": CURRENT_SCHEMA_VERSION, "entries": entries}
    from_label = "v0 (legacy array)" if from_version == 0 else f"v{from_version} (envelope)"
    to_label = f"v{CURRENT_SCHEMA_VERSION} (envelope)"
    dest_desc: str
    if dry_run:
        dest_desc = "(dry-run, nothing written)"
    elif in_place:
        dest_desc = f"{src} (in-place)"
    elif output:
        dest_desc = output
    else:
        dest_desc = "stdout"

    sys.stderr.write(
        "== pretty-index migration ==\n"
        f"from: {from_label:<24} entries: {len(entries)}\n"
        f"to:   {to_label:<24} entries: {len(entries)}\n"
        f"file: {dest_desc}\n"
    )
    if from_version == CURRENT_SCHEMA_VERSION:
        sys.stderr.write("note: already at current schema_version; re-emitting to normalize shape.\n")

    payload = json.dumps(migrated, indent=2, sort_keys=True) + "\n"
    if dry_run:
        return 0
    if in_place:
        src.write_text(payload, encoding="utf-8")
    elif output:
        Path(output).write_text(payload, encoding="utf-8")
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
