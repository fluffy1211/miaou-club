export type SearchPlace = { name: string; center: [number, number] };
export function tileURL(key: string) {
  return (
    "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=" +
    encodeURIComponent(key)
  );
}
export async function searchPlaces(
  query: string,
  key: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SearchPlace[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 100)
    throw new Error("Saisis une ville ou un quartier (2 à 100 caractères).");
  const url = new URL(
    "https://api.maptiler.com/geocoding/" + encodeURIComponent(q) + ".json",
  );
  url.search = new URLSearchParams({
    key,
    country: "fr",
    language: "fr",
    types: "municipality,municipal_district,neighbourhood",
    limit: "5",
  }).toString();
  const response = await fetcher(url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "La recherche est indisponible. Tu peux naviguer sur la carte ou utiliser la liste.",
    );
  const body = await response.json();
  if (!body || !Array.isArray(body.features))
    throw new Error("La recherche est indisponible.");
  return body.features
    .filter(
      (f: { place_name?: unknown; center?: unknown }) =>
        typeof f.place_name === "string" &&
        Array.isArray(f.center) &&
        f.center.length === 2 &&
        f.center.every((n) => typeof n === "number" && Number.isFinite(n)),
    )
    .slice(0, 5)
    .map((f: { place_name: string; center: [number, number] }) => ({
      name: f.place_name,
      center: f.center,
    }));
}
