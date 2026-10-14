const messages: Record<string, string> = {
  friend_limited: "La limite de demandes d’amis est atteinte.",
  photo_size: "Choisis une photo de 30 Mo maximum.",
  photo_pixels: "Cette photo dépasse 60 millions de pixels.",
  photo_format: "Choisis une photo JPEG, PNG ou WebP.",
  photo_decode:
    "Cette photo est illisible ou dépasse 60 millions de pixels. Essaie une autre image.",
  photo_animated: "Choisis une photo fixe, sans animation.",
  heic_unavailable:
    "Cette photo HEIC ne peut pas être lue ici. Exporte-la en JPEG puis réessaie.",
  processing_busy:
    "Une photo est déjà en cours de traitement. Réessaie dans quelques secondes.",
  upload_limited: "La limite d’envoi est atteinte. Réessaie plus tard.",
  publication_limited:
    "La limite de publications est atteinte. Réessaie demain.",
  media_not_ready: "La photo n’est plus prête. Reviens à la sélection.",
  media_used: "Cette photo est déjà publiée. Retrouve-la dans ton carnet.",
  storage_unavailable:
    "Le stockage est indisponible. Tu peux reprendre le traitement plus tard.",
  media_unavailable: "La photo est momentanément indisponible.",
  forbidden: "Cette action n’est pas autorisée pour ton compte.",
  not_found: "Ce souvenir n’est plus accessible.",
  edit_conflict: "Le souvenir a changé. Recharge la page avant de le modifier.",
  idempotency_conflict:
    "Cette publication a déjà été envoyée avec d’autres informations. Vérifie ton carnet.",
  gone: "Ce souvenir a été supprimé.",
  unavailable: "Le club est temporairement indisponible. Réessaie.",
  retry_unavailable:
    "Le traitement ne peut plus être repris. Choisis à nouveau une photo.",
  invalid_location:
    "Choisis une zone en France continentale ou publie sans lieu.",
  location_cannot_reduce:
    "Après publication, la zone peut seulement être agrandie ou retirée.",
  invalid_request: "Vérifie le titre, la date et les informations saisies.",
  upload_timeout: "L’envoi a pris trop de temps. Choisis à nouveau ta photo.",
  unauthenticated: "Connecte-toi pour retrouver ton carnet.",
};
export class EncounterAPIError extends Error {
  constructor(
    public code: string,
    public status: number,
    retryAfter?: number,
  ) {
    super(
      photoMessage(code) +
        (retryAfter ? ` Réessaie dans ${retryAfter} secondes.` : ""),
    );
  }
}
export const photoMessage = (code: string | null) =>
  messages[code ?? "unavailable"] ?? messages.unavailable;
export async function encounterAPI<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  // Bodyless API mutations must reach the server's origin and permission gates
  // when Astro receives the request behind an HTTPS terminating proxy.
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    init?.body == null &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401)
      window.location.assign(
        "/profil?retour=" + encodeURIComponent(window.location.pathname),
      );
    throw new EncounterAPIError(data.code, response.status, data.retryAfter);
  }
  return data;
}
export function jsonRequest(
  body: unknown,
  method = "POST",
  extra: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
  };
}
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const frenchDate = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
