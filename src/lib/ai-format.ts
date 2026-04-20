// Format note content for pasting into AI tools (Cursor, Windsurf, ChatGPT, Claude, Ollama, etc.).
// Strips noise to save tokens while keeping markdown structure intact.

export function formatForAI(slug: string, content: string): string {
  const cleaned = content
    // Remove HTML/markdown comments.
    .replace(/<!--[\s\S]*?-->/g, "")
    // Trim trailing whitespace each line.
    .replace(/[ \t]+$/gm, "")
    // Collapse 3+ blank lines into 2 newlines.
    .replace(/\n{3,}/g, "\n\n")
    // Trim leading/trailing whitespace overall.
    .trim();

  return `# Note: /${slug}\n\n${cleaned}\n`;
}

// Approximate token count using the GPT rule-of-thumb (1 token ≈ 4 chars).
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
