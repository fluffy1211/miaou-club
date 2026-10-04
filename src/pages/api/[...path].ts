import type { APIRoute } from "astro";
import { handleRequest } from "@miaou/server/http";
export const ALL: APIRoute = ({ request }) => handleRequest(request);
