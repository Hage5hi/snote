// Standardized exit codes for the sticky replay CLIs.
//
// These let CI gates and humans distinguish *why* a CLI failed without
// scraping stderr. Documented in docs/ci-sticky-pr-comment.md.
//
//   0  OK
//   1  USAGE   — unknown flag, missing required arg, bad subcommand
//   2  IO      — file not found / read permission error
//   3  PARSE   — file existed but was not valid JSON
//   4  SCHEMA  — JSON parsed but failed strict schema validation
//   5  OTHER   — anything else (kept for future expansion)
//
// Keep this stable; CI workflows can pin numeric codes.

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_IO = 2;
export const EXIT_PARSE = 3;
export const EXIT_SCHEMA = 4;
export const EXIT_OTHER = 5;

export const EXIT_CODE_HELP = `EXIT CODES
  0  OK
  1  USAGE   — unknown flag, missing required argument
  2  IO      — file not found / read error
  3  PARSE   — file is not valid JSON
  4  SCHEMA  — failed strict schema validation
  5  OTHER   — non-schema runtime error
`;
