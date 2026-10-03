export interface SearchableBreed {
  id: string;
  name: string;
  aliases: string[];
  coat: string;
}
export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
export function matching<T extends SearchableBreed>(
  breeds: T[],
  query: string,
  coat = "all",
  sort = "az",
): T[] {
  const q = normalize(query);
  return breeds
    .filter(
      (b) =>
        (!q || [b.name, ...b.aliases].some((n) => normalize(n).includes(q))) &&
        (coat === "all" || b.coat === coat),
    )
    .sort((a, b) =>
      sort === "az"
        ? a.name.localeCompare(b.name, "fr")
        : b.name.localeCompare(a.name, "fr"),
    );
}
export function parseFavorites(
  raw: string | null,
  validIds: string[],
): Set<string> {
  try {
    const values: unknown = JSON.parse(raw || "[]");
    return new Set(
      Array.isArray(values)
        ? values.filter(
            (id): id is string =>
              typeof id === "string" && validIds.includes(id),
          )
        : [],
    );
  } catch {
    return new Set();
  }
}
