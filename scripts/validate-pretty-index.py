#!/usr/bin/env python3
"""Validate pretty-index.json (aggregate CI triage index) against the
documented schema.

Exit codes:
  0  valid
  2  usage
  3  schema validation failed (with a per-entry breakdown on stderr)
  4  file missing
  6  file exists but is not valid JSON / not an array
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REQUIRED = ("folder", "summary_file", "pretty_txt", "pretty_md",
            "fail_reason", "exit_code", "pretty_status", "pretty_exit_code")


def validate_entry(i: int, e: object) -> list[str]:
    if not isinstance(e, dict):
        return [f"[{i}] entry is not an object"]
    problems: list[str] = []
    for k in REQUIRED:
        if k not in e:
            problems.append(f"[{i}] missing key: {k}")
    if "exit_code" in e and not (e["exit_code"] is None or isinstance(e["exit_code"], int)):
        problems.append(f"[{i}] exit_code must be int or null")
    for k in ("folder", "summary_file", "pretty_txt", "pretty_md", "fail_reason", "pretty_status"):
        if k in e and not isinstance(e[k], str):
            problems.append(f"[{i}] {k} must be a string")
    if "pretty_exit_code" in e and not isinstance(e["pretty_exit_code"], int):
        problems.append(f"[{i}] pretty_exit_code must be an int")
    return problems


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write("usage: validate-pretty-index.py <pretty-index.json>\n")
        return 2
    p = Path(argv[1])
    if not p.exists():
        sys.stderr.write(f"validate-pretty-index: file not found: {p}\n")
        return 4
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"validate-pretty-index: cannot parse {p}: {exc}\n")
        return 6
    if not isinstance(data, list):
        sys.stderr.write("validate-pretty-index: top-level must be an array\n")
        return 6
    problems: list[str] = []
    for i, entry in enumerate(data):
        problems.extend(validate_entry(i, entry))
    if problems:
        sys.stderr.write(
            f"validate-pretty-index: schema validation failed for {p} "
            f"({len(problems)} problem(s)):\n"
            + "".join(f"  - {m}\n" for m in problems)
        )
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
