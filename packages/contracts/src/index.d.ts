export type AccessResponse = { status: "authorized" };
export type ApiError = {
  code:
    | "unauthenticated"
    | "forbidden"
    | "unavailable"
    | "not_found"
    | "method_not_allowed";
};

export type HealthResponse = { status: "ok" | "ready" };

export type EncounterDraft = {
  title: string;
  description: string;
  encounterDate: string;
  visibility: "public" | "private";
};
export type EncounterView = EncounterDraft & {
  id: string;
  publishedAt: string;
  revision: number;
  owned: boolean;
  author: string;
  image: string;
  thumbnail: string;
  width: number;
  height: number;
  hidden?: boolean;
  hiddenReason?: string | null;
  location: null;
};
export type MediaView = {
  id: string;
  state: string;
  expiresAt: string;
  width: number | null;
  height: number | null;
  error: string | null;
  image: string | null;
};
