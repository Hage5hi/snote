import type { TokenizerAndRendererExtension, Tokens } from "marked";

const GFM_ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
export type GfmAlertType = (typeof GFM_ALERT_TYPES)[number];

const TYPE_RE = "NOTE|TIP|IMPORTANT|WARNING|CAUTION";
const MARKER_RE = new RegExp(`^> \\[!(${TYPE_RE})\\][ \\t]*(?:\\n|$)`, "i");
const MARKER_LINE_RE = new RegExp(`^> \\[!(${TYPE_RE})\\][ \\t]*$`, "i");

type GfmAlertToken = Tokens.Generic & {
  type: "gfmAlert";
  alertType: GfmAlertType;
  tokens: Tokens.Generic[];
};

function isAlertType(value: string): value is GfmAlertType {
  return (GFM_ALERT_TYPES as readonly string[]).includes(value);
}

/** GitHub docs: `> [!NOTE]` on its own line. No custom title, no Obsidian `+`/`-`. */
function parseGfmAlertMarker(line: string): GfmAlertType | null {
  const match = MARKER_LINE_RE.exec(line);
  if (!match) return null;
  const type = match[1].toUpperCase();
  return isAlertType(type) ? type : null;
}

export const gfmAlertExtension: TokenizerAndRendererExtension = {
  name: "gfmAlert",
  level: "block",
  start(source: string) {
    const match = /(?:^|\n)> \[!/i.exec(source);
    if (!match) return undefined;
    return match[0].startsWith("\n") ? match.index + 1 : match.index;
  },
  tokenizer(this, source: string) {
    const marker = MARKER_RE.exec(source);
    if (!marker) return undefined;
    const type = marker[1].toUpperCase();
    if (!isAlertType(type)) return undefined;

    let raw = marker[0];
    let rest = source.slice(marker[0].length);
    const bodyLines: string[] = [];

    while (rest.length > 0) {
      const newline = rest.indexOf("\n");
      const line = newline === -1 ? rest : rest.slice(0, newline);
      const consumed = newline === -1 ? rest : rest.slice(0, newline + 1);
      if (!line.startsWith(">")) break;
      if (parseGfmAlertMarker(line)) break;
      bodyLines.push(line.replace(/^>[ \t]?/, ""));
      raw += consumed;
      rest = rest.slice(consumed.length);
    }

    const body = bodyLines.join("\n");
    return {
      type: "gfmAlert",
      raw,
      alertType: type,
      tokens: this.lexer.blockTokens(body),
    } satisfies GfmAlertToken;
  },
  childTokens: ["tokens"],
  renderer(this, token) {
    const alert = token as GfmAlertToken;
    const kind = alert.alertType.toLowerCase();
    const body = this.parser.parse(alert.tokens);
    return `<div class="md-alert md-alert-${kind}" data-md-alert="${kind}"><p class="md-alert-title" data-md-alert-title="${kind}"></p>\n${body}</div>\n`;
  },
};
