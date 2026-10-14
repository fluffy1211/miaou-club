import { BlockList, isIP } from "node:net";

function normalizeIP(value) {
  if (typeof value !== "string" || value.includes("%")) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(ip);
  if (!mapped) return ip;
  const high = parseInt(mapped[1], 16),
    low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

// No implicit trust in private networks or provider environment flags.
export function createClientIPResolver(cidrs = "") {
  const trusted = new BlockList();
  const enabled = cidrs !== "";
  if (typeof cidrs !== "string") throw new Error("Invalid trusted proxy CIDRs");
  if (enabled) {
    for (const item of cidrs.split(",")) {
      const parts = item.trim().split("/");
      const ip = normalizeIP(parts[0]);
      const bits = parts[1];
      const family = ip && isIP(ip);
      if (
        parts.length !== 2 ||
        !ip ||
        !/^\d+$/.test(bits) ||
        Number(bits) < 1 ||
        Number(bits) > (family === 4 ? 32 : 128)
      ) {
        throw new Error("Invalid trusted proxy CIDRs");
      }
      trusted.addSubnet(ip, Number(bits), family === 4 ? "ipv4" : "ipv6");
    }
  }
  const isTrusted = (ip) => trusted.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  return (socketIP, forwardedFor) => {
    const peer = normalizeIP(socketIP);
    if (!peer) return null;
    if (!enabled || !isTrusted(peer)) return peer;
    // Node joins duplicate XFF fields in wire order. Arrays are deliberately rejected.
    if (typeof forwardedFor !== "string" || forwardedFor.length > 4096)
      return null;
    const parts = forwardedFor.split(",");
    if (parts.length > 32) return null;
    const chain = parts.map((part) => normalizeIP(part.trim()));
    if (chain.some((ip) => !ip)) return null;
    for (let index = chain.length - 1; index >= 0; index--) {
      if (!isTrusted(chain[index])) return chain[index];
    }
    return null;
  };
}
