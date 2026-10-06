import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
export interface ObjectStorage {
  put(key: string, bytes: Buffer, type: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(keys: string[]): Promise<void>;
}
function safeKey(key: string) {
  if (!/^[a-f0-9-]{36}\/(original|image.webp|thumb.webp)$/.test(key))
    throw new Error("Invalid object key");
  return key;
}
// Development/test storage is outside every static directory; never served directly.
export class LocalStorage implements ObjectStorage {
  constructor(private root: string) {}
  private path(key: string) {
    return resolve(this.root, safeKey(key));
  }
  async put(key: string, bytes: Buffer) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = path + ".tmp";
    try {
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async remove(keys: string[]) {
    for (const key of keys) {
      await rm(this.path(key), { force: true });
      await rm(this.path(key) + ".tmp", { force: true });
    }
  }
}
export class SupabaseStorage implements ObjectStorage {
  private client;
  constructor(
    url: string,
    secret: string,
    private bucket: string,
  ) {
    if (new URL(url).protocol !== "https:" || !/^[a-z0-9-]+$/.test(bucket))
      throw new Error("Invalid storage configuration");
    this.client = createClient(url, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    });
  }
  private async privateBucket() {
    const { data, error } = await this.client.storage.getBucket(this.bucket);
    if (error || !data || data.public !== false)
      throw new Error("Private bucket unavailable");
  }
  async put(key: string, bytes: Buffer, type: string) {
    await this.privateBucket();
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(safeKey(key), bytes, {
        contentType: type,
        upsert: true,
        cacheControl: "0",
      });
    if (error) throw new Error("Storage write failed");
  }
  async get(key: string) {
    await this.privateBucket();
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(safeKey(key));
    if (error || !data) throw new Error("Storage read failed");
    if (data.size > 30000000) throw new Error("Storage object too large");
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(keys: string[]) {
    await this.privateBucket();
    const { error } = await this.client.storage
      .from(this.bucket)
      .remove(keys.map(safeKey));
    if (error) throw new Error("Storage deletion failed");
  }
}
class UnconfiguredStorage implements ObjectStorage {
  async put(): Promise<void> {
    throw new Error("Storage not configured");
  }
  async get(): Promise<Buffer> {
    throw new Error("Storage not configured");
  }
  async remove(): Promise<void> {
    throw new Error("Storage not configured");
  }
}
export function storageFromEnvironment(): ObjectStorage {
  const url = process.env.MIAOU_STORAGE_URL,
    key = process.env.MIAOU_STORAGE_SECRET,
    bucket = process.env.MIAOU_STORAGE_BUCKET;
  if (url && key && bucket) return new SupabaseStorage(url, key, bucket);
  if (url || key || bucket) throw new Error("Incomplete storage configuration");
  if (process.env.MIAOU_LOCAL_MEDIA_DIR) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Local media storage is development/test only");
    const root = resolve(process.env.MIAOU_LOCAL_MEDIA_DIR);
    if (
      !root.startsWith(resolve(process.cwd(), ".cache") + "/") &&
      !root.startsWith("/private/tmp/")
    )
      throw new Error("Local media must be outside public directories");
    return new LocalStorage(root);
  }
  return new UnconfiguredStorage();
}
export const objectKeys = (id: string) => [
  id + "/original",
  id + "/image.webp",
  id + "/thumb.webp",
];
