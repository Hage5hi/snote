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
    sys.stdout.write(render(summary))
    code = summary.get("exit_code")
    return int(code) if isinstance(code, int) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
