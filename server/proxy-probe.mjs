import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { createClientIPResolver } from "./client-ip.mjs";

const normalize = createClientIPResolver();
const headerName = "x-miaou-proxy-probe";
function stripCapability(req) {
  delete req.headers[headerName];
  const headers = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() !== headerName)
      headers.push(req.rawHeaders[index], req.rawHeaders[index + 1]);
  }
  req.rawHeaders = headers;
}

// SHA256 hashes the ASCII hex bearer; HMAC uses its decoded 32 bytes.
export function parseProxyProbeEnv(env, now = Date.now()) {
  const capabilityDigest = env.MIAOU_PROXY_PROBE_SHA256 ?? "";
  const expiry = env.MIAOU_PROXY_PROBE_EXPIRES_AT ?? "";
  if (capabilityDigest === "" && expiry === "")
    return { capabilityDigest: "", expiresAt: 0 };
  if (
    typeof capabilityDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(capabilityDigest) ||
    typeof expiry !== "string" ||
    !/^[1-9]\d*$/.test(expiry)
  )
    return null;
  const expiresAt = Number(expiry);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + 900000
  )
    return null;
  return { capabilityDigest, expiresAt };
}

// Temporary qualification only. Configuration is deliberately disabled by default.
// Fingerprints identify observations; they never authorize a proxy or a client.
export function createProxyProbe({
  capabilityDigest = "",
  expiresAt = 0,
} = {}) {
  if (capabilityDigest === "" && expiresAt === 0) return stripCapability;
  const remaining = expiresAt - Date.now();
  if (
    !/^[a-f0-9]{64}$/.test(capabilityDigest) ||
    !Number.isSafeInteger(expiresAt) ||
    remaining <= 0 ||
    remaining > 15 * 60 * 1000
  )
    return stripCapability;
  const expected = Buffer.from(capabilityDigest, "hex");
  const deadline = performance.now() + remaining;
  let observations = 0;
  return (req, res, requestId) => {
    const capability = req.headers[headerName];
    const capabilityFields = req.rawHeaders
      .filter((_, index) => index % 2 === 0)
      .filter((name) => name.toLowerCase() === headerName).length;
    stripCapability(req);
    if (
      req.method !== "GET" ||
      req.url !== "/api/ready" ||
      req.headers.cookie !== undefined ||
      req.headers.authorization !== undefined ||
      req.headers["proxy-authorization"] !== undefined ||
      capabilityFields !== 1 ||
      Date.now() >= expiresAt ||
      performance.now() >= deadline ||
      observations >= 16 ||
      typeof capability !== "string" ||
      !/^[a-f0-9]{64}$/.test(capability)
    )
      return;
    const digest = createHash("sha256").update(capability).digest();
    if (!timingSafeEqual(digest, expected)) return;
    const describe = (value) => {
      const ip = normalize(value);
      return ip
        ? {
            family: isIP(ip),
            fingerprint: createHmac("sha256", Buffer.from(capability, "hex"))
              .update("miaou-proxy-probe-v1:" + ip)
              .digest("hex"),
          }
        : { invalid: true };
    };
    const xff = req.headers["x-forwarded-for"];
    let forwarded;
    if (xff === undefined) forwarded = { state: "missing" };
    else if (typeof xff !== "string") forwarded = { state: "invalid" };
    else if (xff.length > 4096) forwarded = { state: "excessive" };
    else {
      const values = xff.split(",");
      forwarded =
        values.length > 32
          ? { state: "excessive" }
          : {
              state: "observed",
              entries: values.map((value) => describe(value.trim())),
            };
    }
    const xffFields = req.rawHeaders
      .filter((_, index) => index % 2 === 0)
      .filter((name) => name.toLowerCase() === "x-forwarded-for").length;
    observations++;
    // Allowlisted fields only: never serialize req, headers, raw values or token.
    const record = {
      event: "proxy_probe",
      requestId,
      observation: observations,
      socket: describe(req.socket.remoteAddress),
      forwarded,
      xffFields,
      cfConnectingIP: describe(req.headers["cf-connecting-ip"]),
      trueClientIP: describe(req.headers["true-client-ip"]),
      headerTrust: "observed_untrusted",
    };
    res.once("finish", () => {
      try {
        console.log(JSON.stringify(record));
      } catch {
        /* Preserve health response. */
      }
    });
  };
}
