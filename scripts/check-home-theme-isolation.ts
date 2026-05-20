import { readFileSync } from "node:fs";

const HOME = "src/pages/Home.tsx";
const NOTE_SURFACES = [
  "src/pages/NotePage.tsx",
  "src/components/note/Editor.tsx",
  "src/components/note/Preview.tsx",
];

const home = readFileSync(HOME, "utf8");
for (const token of ["isCyber", 'data-theme={isCyber ? "cyber" : undefined}', "data-home-root"]) {
  if (!home.includes(token)) throw new Error(`Home missing scoped cyber token: ${token}`);
}

const forbidden = ["isCyber", 'data-theme="cyber"', "data-theme={isCyber", "data-home-root", "scene-theme-change"];
for (const file of NOTE_SURFACES) {
  const source = readFileSync(file, "utf8");
  for (const token of forbidden) {
    if (source.includes(token)) throw new Error(`${file} leaks Home cyber token: ${token}`);
  }
}

console.log("✓ Home cyber theme is isolated from NotePage/Editor/Preview");