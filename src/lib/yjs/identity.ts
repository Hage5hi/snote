// Random anonymous identity per browser tab session, persisted to localStorage.
import { safeLocalStorageSet } from "@/lib/safe-storage";

const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899", "#f43f5e",
];

const ANIMALS = [
  "Otter", "Fox", "Owl", "Panda", "Koala", "Lynx", "Hawk",
  "Tiger", "Wolf", "Bear", "Seal", "Crow", "Deer", "Hare",
  "Mole", "Newt", "Swan", "Yak", "Crab", "Frog",
];

export type Identity = { name: string; color: string };

const KEY = "note.identity";

export function getIdentity(): Identity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const name = `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}-${Math.floor(
    Math.random() * 1000
  )}`;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const identity = { name, color };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // ignore
  }
  return identity;
}

export function setIdentityName(name: string) {
  const id = getIdentity();
  const next = { ...id, name: name.trim().slice(0, 32) || id.name };
  safeLocalStorageSet(KEY, JSON.stringify(next));
  return next;
}
