/** Returns distinct catalogue ids in a stable, date-based random order. */
export function dailyDiscoveryIds(ids: string[], date: string, count = 3) {
  const shuffled = [...ids];
  let state = 0;

  for (const character of date) state = (state * 31 + character.charCodeAt(0)) >>> 0;
  for (let index = shuffled.length - 1; index > 0; index--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const otherIndex = state % (index + 1);
    [shuffled[index], shuffled[otherIndex]] = [
      shuffled[otherIndex],
      shuffled[index],
    ];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}
