export function decodePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
export function decodeHandle(value: string): string | null {
  const handle = decodePath(value);
  return handle !== null && /^[a-z0-9_]{3,30}$/.test(handle) ? handle : null;
}
