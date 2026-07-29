import "server-only";
import { keccak256, recoverMessageAddress, toHex } from "viem";

export interface ImportedSoul {
  content: string;
  sourceUrl: string;
  // Set only when the source was a signed soulweaver soul AND every check
  // passed: contentHash commits to the content, the signing message embeds
  // that hash, and EIP-191 recovery yields the claimed signer.
  verifiedSigner: string | null;
}

const MAX_SOUL_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

// Server-side fetch of a user-supplied URL — keep it away from the private
// network. Hostname-literal checks only (no DNS resolution): this is a guard
// against casual SSRF, not a security boundary; the callers are authenticated
// users of a self-hosted app.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("[::1]") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

interface SoulweaverPayload {
  soul?: {
    content?: unknown;
    contentHash?: unknown;
    signature?: unknown;
    signerAddress?: unknown;
  };
  verification?: { message?: unknown } | null;
}

/**
 * Fetch a SOUL.md from a URL. Two source shapes:
 *  - soulweaver's public souls API (JSON: { soul: { content, contentHash,
 *    signature, signerAddress }, verification: { message } }) — verified via
 *    EIP-191 recovery when signed;
 *  - any URL serving the markdown directly (IPFS gateway, raw file).
 */
export async function fetchSoulFromUrl(rawUrl: string): Promise<ImportedSoul> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs are supported");
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error("This host is not allowed");
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json, text/markdown, text/plain" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status}`);
  }
  const text = await res.text();
  if (new TextEncoder().encode(text).length > MAX_SOUL_BYTES) {
    throw new Error("Soul file too large");
  }

  // Try the soulweaver JSON shape first; anything else is raw markdown.
  let payload: SoulweaverPayload | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") payload = parsed as SoulweaverPayload;
  } catch {}

  if (payload?.soul && typeof payload.soul.content === "string") {
    const { content, contentHash, signature, signerAddress } = payload.soul;
    let verifiedSigner: string | null = null;
    const message = payload.verification?.message;
    if (
      typeof contentHash === "string" &&
      typeof signature === "string" &&
      typeof signerAddress === "string" &&
      typeof message === "string"
    ) {
      verifiedSigner = await verifySoulweaverSignature(
        content,
        contentHash,
        signature,
        signerAddress,
        message
      );
    }
    return { content, sourceUrl: rawUrl, verifiedSigner };
  }

  return { content: text, sourceUrl: rawUrl, verifiedSigner: null };
}

/**
 * Full verification chain for a soulweaver soul. Returns the normalized
 * signer address on success, null on any mismatch (never throws — an
 * unverifiable signature downgrades to an unverified import, it doesn't
 * block it).
 */
async function verifySoulweaverSignature(
  content: string,
  contentHash: string,
  signature: string,
  signerAddress: string,
  message: string
): Promise<string | null> {
  try {
    // 1. The hash must commit to the exact content we received.
    if (keccak256(toHex(content)).toLowerCase() !== contentHash.toLowerCase()) {
      return null;
    }
    // 2. The signing message must embed that hash (soulweaver format:
    //    {contentHash}|{chainId}:{contract}:{tokenId}|codex-v{N}).
    if (!message.toLowerCase().startsWith(contentHash.toLowerCase())) {
      return null;
    }
    // 3. EIP-191 personal_sign recovery must yield the claimed signer.
    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
    if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
      return null;
    }
    return recovered.toLowerCase();
  } catch {
    return null;
  }
}
