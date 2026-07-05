#!/usr/bin/env python3
"""Validate pretty-index.json (aggregate CI triage index) against the
documented schema.

Accepted top-level shapes:
  * Legacy (v0): a bare JSON array of entries.
  * Versioned (v>=1): an object {"schema_version": <int>, "entries": [...]}
    where ``schema_version`` MUST be one of ``SUPPORTED_SCHEMA_VERSIONS``.
    Unknown versions yield a clear "unsupported schema_version" error
    instead of a cryptic per-entry breakdown.

Exit codes:
  0  valid
  2  usage
  3  schema validation failed (with a per-entry breakdown on stderr)
  4  file missing
  6  file exists but is not valid JSON / not a recognized top-level shape

Flags:
  --report / --print-errors
      In addition to the human-readable stderr breakdown, print a
      machine-readable JSON report to STDOUT with objects of shape:
        {"index": int|null, "path": "entries[i].field",
         "expected": str, "actual": str, "message": str}
      Intended for local triage and editor integrations.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REQUIRED = ("folder", "summary_file", "pretty_txt", "pretty_md",
            "fail_reason", "exit_code", "pretty_status", "pretty_exit_code")

# Bump when the entry shape (or top-level envelope) changes in a way that
# older validators cannot verify.  Keep old versions in the set until the
# CI workflow is guaranteed to have been rebuilt.
SUPPORTED_SCHEMA_VERSIONS = frozenset({0, 1})
CURRENT_SCHEMA_VERSION = 1


def _describe(value: object) -> str:
    if value is None:
        return "null"
    return type(value).__name__


def validate_entry(i: int, e: object) -> list[dict]:
    """Return a list of structured problem dicts (empty when valid)."""
    if not isinstance(e, dict):
        return [{
            "index": i,
            "path": f"entries[{i}]",
            "expected": "object",
            "actual": _describe(e),
            "message": f"[{i}] entry is not an object",
        }]
    problems: list[dict] = []
    for k in REQUIRED:
        if k not in e:
            problems.append({
                "index": i,
                "path": f"entries[{i}].{k}",
                "expected": "present",
                "actual": "missing",
                "message": f"[{i}] missing key: {k}",
            })
    if "exit_code" in e and not (e["exit_code"] is None or isinstance(e["exit_code"], int)):
        problems.append({
            "index": i,
            "path": f"entries[{i}].exit_code",
            "expected": "int|null",
            "actual": _describe(e["exit_code"]),
            "message": f"[{i}] exit_code must be int or null",
        })
    for k in ("folder", "summary_file", "pretty_txt", "pretty_md", "fail_reason", "pretty_status"):
        if k in e and not isinstance(e[k], str):
            problems.append({
                "index": i,
                "path": f"entries[{i}].{k}",
                "expected": "string",
                "actual": _describe(e[k]),
                "message": f"[{i}] {k} must be a string",
            })
    if "pretty_exit_code" in e and not isinstance(e["pretty_exit_code"], int):
        problems.append({
            "index": i,
            "path": f"entries[{i}].pretty_exit_code",
            "expected": "int",
            "actual": _describe(e.get("pretty_exit_code")),
            "message": f"[{i}] pretty_exit_code must be an int",
        })
    return problems


def _normalize(data: object) -> tuple[list | None, list[dict]]:
    """Return (entries, problems). ``entries`` is None on envelope errors."""
    if isinstance(data, list):
        return data, []  # legacy v0
    if isinstance(data, dict):
        # Only treat as a versioned envelope when at least one envelope
        # key is present; otherwise fall through to the "unrecognized
        # top-level" branch (exit 6) for backward-compatibility with
        # callers that expected an array.
        if "schema_version" not in data and "entries" not in data:
            return None, []
        if "schema_version" not in data:
            return None, [{
                "index": None, "path": "$.schema_version",
                "expected": "int", "actual": "missing",
                "message": "top-level object is missing schema_version",
            }]

        v = data.get("schema_version")
        if not isinstance(v, int) or isinstance(v, bool):
            return None, [{
                "index": None, "path": "$.schema_version",
                "expected": "int", "actual": _describe(v),
                "message": "schema_version must be an int",
            }]
        if v not in SUPPORTED_SCHEMA_VERSIONS:
            return None, [{
                "index": None, "path": "$.schema_version",
                "expected": f"one of {sorted(SUPPORTED_SCHEMA_VERSIONS)}",
                "actual": str(v),
                "message": (
                    f"unsupported schema_version={v} "
                    f"(this validator supports {sorted(SUPPORTED_SCHEMA_VERSIONS)}; "
                    f"current={CURRENT_SCHEMA_VERSION})"
                ),
            }]
        entries = data.get("entries")
        if not isinstance(entries, list):
            return None, [{
                "index": None, "path": "$.entries",
                "expected": "array", "actual": _describe(entries),
                "message": "entries must be an array",
            }]
        return entries, []
    return None, []


def main(argv: list[str]) -> int:
    args = argv[1:]
    report = False
    for flag in ("--report", "--print-errors"):
        if flag in args:
            report = True
            args.remove(flag)
    if len(args) != 1:
        sys.stderr.write(
            "usage: validate-pretty-index.py [--report] <pretty-index.json>\n"
        )
        return 2
    p = Path(args[0])
    if not p.exists():
        sys.stderr.write(f"validate-pretty-index: file not found: {p}\n")
        return 4
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"validate-pretty-index: cannot parse {p}: {exc}\n")
        return 6

    entries, envelope_problems = _normalize(data)
    if entries is None and not envelope_problems:
        sys.stderr.write(
            "validate-pretty-index: top-level must be an array or "
            "{schema_version, entries} object\n"
        )
        return 6

    problems: list[dict] = list(envelope_problems)
    if entries is not None:
        for i, entry in enumerate(entries):
            problems.extend(validate_entry(i, entry))

    if problems:
        sys.stderr.write(
            f"validate-pretty-index: schema validation failed for {p} "
            f"({len(problems)} problem(s)):\n"
            + "".join(f"  - {m['message']}\n" for m in problems)
        )
        if report:
            json.dump(
                {"file": str(p), "problems": problems},
                sys.stdout, indent=2, sort_keys=True,
            )
            sys.stdout.write("\n")
        return 3

    if report:
        json.dump(
            {"file": str(p), "problems": []},
            sys.stdout, indent=2, sort_keys=True,
        )
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
