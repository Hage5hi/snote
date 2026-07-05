#!/usr/bin/env python3
"""Pretty-print a schema-drift-diff replay-summary.json for debugging.

Usage:
  scripts/pretty-replay-summary.py <path/to/replay-summary.json> [options]
  cat replay-summary.json | scripts/pretty-replay-summary.py -

Options:
  --fixed-widths        Render the manifest_mapping table with fixed column
                        widths (entry=40, file=48) instead of auto-sizing.
                        Guarantees byte-identical output across environments
                        with different manifest values.
  --markdown            Render the manifest_mapping table as a
                        GitHub-friendly Markdown table (`| col | ... |`).
                        Combine with --fixed-widths for deterministic
                        cell padding.
  --no-color            No-op today (script emits no ANSI colors); accepted
                        for forward-compatibility so CI can pin deterministic
                        rendering. NO_COLOR env var is also honored.
  -h, --help            Show this help.

Exit codes:
  0  success (or mirrors summary.exit_code when it is an int)
  2  usage / argument error
  3  schema validation failed (see validate())
  4  input file is missing
  5  input file exists but is unreadable (permission, I/O)
  6  input file is not valid JSON, or top-level is not an object
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_SCHEMA = 3
EXIT_MISSING = 4
EXIT_UNREADABLE = 5
EXIT_PARSE = 6

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

FIXED_ENTRY_WIDTH = 40
FIXED_FILE_WIDTH = 48


def render(summary: dict, *, fixed_widths: bool = False, markdown: bool = False) -> str:
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
        if fixed_widths:
            entry_w = FIXED_ENTRY_WIDTH
            file_w = FIXED_FILE_WIDTH
        else:
            entry_w = max(len(str(m.get("manifest_entry", ""))) for m in mapping)
            file_w = max(len(str(m.get("required_file", ""))) for m in mapping)
        if markdown:
            # GitHub-friendly Markdown table. Cells are padded to the same
            # fixed widths so `--fixed-widths --markdown` output is
            # deterministic across environments and line-ending styles.
            role_w = max(4, max((len(str(m.get("role", ""))) for m in mapping), default=4))
            lines.append(
                f"| {'manifest_entry'.ljust(entry_w)} | {'required_file'.ljust(file_w)} | {'role'.ljust(role_w)} |"
            )
            lines.append(
                f"| {'-' * entry_w} | {'-' * file_w} | {'-' * role_w} |"
            )
            for m in mapping:
                lines.append(
                    f"| {str(m.get('manifest_entry', '')).ljust(entry_w)}"
                    f" | {str(m.get('required_file', '')).ljust(file_w)}"
                    f" | {str(m.get('role', '')).ljust(role_w)} |"
                )
        else:
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
    args = argv[1:]
    if not args or "-h" in args or "--help" in args:
        sys.stderr.write(__doc__ or "")
        return EXIT_USAGE
    fixed_widths = False
    markdown = False
    output_json: str | None = None
    pretty_txt: str | None = None
    pretty_md: str | None = None
    # --no-color is accepted (no-op) for deterministic CI rendering.
    positional: list[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--fixed-widths":
            fixed_widths = True
        elif a == "--markdown":
            markdown = True
        elif a == "--no-color":
            pass
        elif a in ("--output-json", "--pretty-txt", "--pretty-md"):
            i += 1
            if i >= len(args):
                sys.stderr.write(f"pretty-replay-summary: {a} requires a path argument\n")
                return EXIT_USAGE
            if a == "--output-json":
                output_json = args[i]
            elif a == "--pretty-txt":
                pretty_txt = args[i]
            else:
                pretty_md = args[i]
        elif a.startswith("--"):
            sys.stderr.write(f"pretty-replay-summary: unknown flag: {a}\n")
            return EXIT_USAGE
        else:
            positional.append(a)
        i += 1
    if os.environ.get("NO_COLOR"):
        pass  # explicit no-op; script emits no ANSI colors
    if len(positional) != 1:
        sys.stderr.write("pretty-replay-summary: expected exactly one input path (or '-')\n")
        return EXIT_USAGE
    src = positional[0]

    if src == "-":
        try:
            raw = sys.stdin.read()
        except OSError as exc:
            sys.stderr.write(f"pretty-replay-summary: cannot read stdin: {exc}\n")
            return EXIT_UNREADABLE
    else:
        p = Path(src)
        if not p.exists():
            sys.stderr.write(f"pretty-replay-summary: file not found: {src}\n")
            return EXIT_MISSING
        try:
            raw = p.read_text(encoding="utf-8")
        except OSError as exc:
            sys.stderr.write(f"pretty-replay-summary: cannot read {src}: {exc}\n")
            return EXIT_UNREADABLE

    try:
        summary = json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"pretty-replay-summary: cannot parse {src}: {exc}\n")
        return EXIT_PARSE
    if not isinstance(summary, dict):
        sys.stderr.write("pretty-replay-summary: top-level JSON must be an object\n")
        return EXIT_PARSE

    problems = validate(summary)
    if problems:
        sys.stderr.write(
            f"pretty-replay-summary: schema validation failed for {src}:\n"
            + "".join(f"  - {p}\n" for p in problems)
        )
        return EXIT_SCHEMA
    sys.stdout.write(render(summary, fixed_widths=fixed_widths, markdown=markdown))
    code = summary.get("exit_code")

    if output_json is not None:
        report = {
            "summary_file": src,
            "fail_reason": summary.get("fail_reason", ""),
            "exit_code": code if isinstance(code, int) else None,
            "pretty_txt": pretty_txt,
            "pretty_md": pretty_md,
        }
        try:
            Path(output_json).write_text(
                json.dumps(report, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
        except OSError as exc:
            sys.stderr.write(f"pretty-replay-summary: cannot write {output_json}: {exc}\n")
            return EXIT_UNREADABLE

    return int(code) if isinstance(code, int) else EXIT_OK




if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
