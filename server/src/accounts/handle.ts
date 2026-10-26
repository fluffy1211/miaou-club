// The public handle is the member's only name: chosen once, shown everywhere.
const reserved = ["admin", "miaou", "support", "system"];
export function publicHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().toLowerCase();
  return /^[a-z0-9_]{3,30}$/.test(handle) && !reserved.includes(handle)
    ? handle
    : null;
}
