#!/usr/bin/env python3
"""Pretty-print a schema-drift-diff replay-summary.json for debugging.

Usage:
  scripts/pretty-replay-summary.py <path/to/replay-summary.json>
  cat replay-summary.json | scripts/pretty-replay-summary.py -

Prints top-level fields in a fixed, readable order, followed (when
present) by the `manifest_mapping` table produced under --verbose.
Exit code mirrors the summarised replay's own exit_code when set,
otherwise 0 on parse success and 2 on parse/argument errors.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

FIELD_ORDER = [
    "mode",
    "exit_code",
    "duration_seconds",
    "checksum_verified",
    "seed",
    "reader_ms",
    "pattern",
    "timeout_ms",
    "missing_files",
    "fail_reason",
    "folder",
]


def render(summary: dict) -> str:
    lines: list[str] = ["== replay-summary =="]
    width = max(len(k) for k in FIELD_ORDER)
    for key in FIELD_ORDER:
        if key not in summary:
            continue
        val = summary[key]
        if isinstance(val, list):
            if not val:
                lines.append(f"{key.ljust(width)} : (none)")
            else:
                lines.append(f"{key.ljust(width)} :")
                for item in val:
                    lines.append(f"  - {item}")
        elif val is None:
            lines.append(f"{key.ljust(width)} : (null)")
        else:
            lines.append(f"{key.ljust(width)} : {val}")

    mapping = summary.get("manifest_mapping") or []
    if mapping:
        lines.append("")
        lines.append("-- manifest_mapping --")
        entry_w = max(len(str(m.get("manifest_entry", ""))) for m in mapping)
        file_w = max(len(str(m.get("required_file", ""))) for m in mapping)
        header = f"  {'manifest_entry'.ljust(entry_w)}  {'required_file'.ljust(file_w)}  role"
        lines.append(header)
        lines.append(f"  {'-' * entry_w}  {'-' * file_w}  {'-' * 4}")
        for m in mapping:
            lines.append(
                f"  {str(m.get('manifest_entry', '')).ljust(entry_w)}"
                f"  {str(m.get('required_file', '')).ljust(file_w)}"
                f"  {m.get('role', '')}"
            )
    return "\n".join(lines) + "\n"


def validate(summary: dict) -> list[str]:
    """Return a list of schema problems (empty when the summary is valid).

    Contract:
      - `fail_reason` is REQUIRED and must be a string (may be "").
      - `manifest_mapping`, when present, must be a list of objects each
        carrying string `manifest_entry`, `required_file`, and `role`.
      - Missing `manifest_mapping` and empty `manifest_mapping` are BOTH
        valid — the mapping is only populated when the helper runs with
        `--verbose`.
    """
    problems: list[str] = []
    if "fail_reason" not in summary:
        problems.append("fail_reason is missing (required in every replay-summary.json)")
    elif not isinstance(summary["fail_reason"], str):
        problems.append("fail_reason must be a string")
    if "manifest_mapping" in summary:
        mapping = summary["manifest_mapping"]
        if not isinstance(mapping, list):
            problems.append("manifest_mapping must be an array when present")
        else:
            for i, m in enumerate(mapping):
                if not isinstance(m, dict):
                    problems.append(f"manifest_mapping[{i}] must be an object")
                    continue
                for k in ("manifest_entry", "required_file", "role"):
                    if k not in m:
                        problems.append(f"manifest_mapping[{i}].{k} is missing")
                    elif not isinstance(m[k], str):
                        problems.append(f"manifest_mapping[{i}].{k} must be a string")
    return problems


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] in ("-h", "--help"):
        sys.stderr.write(__doc__ or "")
        return 2
    src = argv[1]
    try:
        raw = sys.stdin.read() if src == "-" else Path(src).read_text(encoding="utf-8")
        summary = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"pretty-replay-summary: cannot parse {src}: {exc}\n")
        return 2
    if not isinstance(summary, dict):
        sys.stderr.write("pretty-replay-summary: top-level JSON must be an object\n")
        return 2
    problems = validate(summary)
    if problems:
        sys.stderr.write(
            f"pretty-replay-summary: schema validation failed for {src}:\n"
            + "".join(f"  - {p}\n" for p in problems)
        )
        return 3
    sys.stdout.write(render(summary))
    code = summary.get("exit_code")
    return int(code) if isinstance(code, int) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
