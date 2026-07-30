import "server-only";
import { hash, verify } from "@node-rs/argon2";

// argon2id defaults tuned for interactive login (~50-100ms on modern hardware).
const OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

// Fails closed on any malformed digest — OIDC-provisioned accounts store ""
// as an unusable sentinel, and argon2 throws (rather than returning false)
// on a non-PHC-formatted input.
export async function verifyPassword(
  digest: string,
  password: string
): Promise<boolean> {
  if (!digest) return false;
  try {
    return await verify(digest, password);
  } catch {
    return false;
  }
}
