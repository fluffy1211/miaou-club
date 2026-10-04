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
