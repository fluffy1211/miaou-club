import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Cache<T> {
  url: string;
  fetchedAt: string;
  payload: T;
}
interface Options<T> {
  name: string;
  url: string;
  parse: (value: unknown) => T;
  fetcher?: typeof fetch;
  headers?: Record<string, string>;
  cacheDir?: string;
  refresh?: boolean;
  now?: number;
  warn?: (message: string) => void;
}
const DAY = 86_400_000;

/** Only validated real responses are cached. There is no synthetic-data fallback. */
export async function fetchApi<T>({
  name,
  url,
  parse,
  fetcher = fetch,
  headers = {},
  cacheDir = join(process.cwd(), ".cache/miaou-api"),
  refresh = process.env.MIAOU_REFRESH_API === "1",
  now = Date.now(),
  warn = console.warn,
}: Options<T>): Promise<Cache<T>> {
  const path = join(cacheDir, `${name}.json`);
  let cached: Cache<T> | undefined;
  try {
    const envelope = JSON.parse(await readFile(path, "utf8"));
    const timestamp = Date.parse(envelope.fetchedAt);
    if (
      envelope.url === url &&
      Number.isFinite(timestamp) &&
      timestamp <= now
    ) {
      cached = {
        url,
        fetchedAt: envelope.fetchedAt,
        payload: parse(envelope.payload),
      };
    }
  } catch {
    /* Missing or invalid cache must be refreshed from the API. */
  }
  const age = cached ? now - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && age < DAY && !refresh) return cached;
  try {
    const response = await fetcher(url, {
      headers: {
        ...headers,
        Accept: "application/json",
        "User-Agent": "MiaouClub/0.1 (local cat breed catalogue)",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = {
      url,
      fetchedAt: new Date(now).toISOString(),
      payload: parse(await response.json()),
    };
    await mkdir(cacheDir, { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(result));
    await rename(temp, path);
    return result;
  } catch (error) {
    if (cached && age < 7 * DAY && !refresh) {
      warn(
        `[Miaou Club] ${name} indisponible : réponse API du ${cached.fetchedAt} utilisée temporairement.`,
      );
      return cached;
    }
    throw new Error(
      `[Miaou Club] Impossible de charger ${name} depuis ${url}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
