import { createHash } from "node:crypto";
import { canonicalize, type CanonicalValue } from "./canonical.js";

export function sha256Hex(input: Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalBytes(value: CanonicalValue): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

/** sha256 over the canonical JSON bytes of `value`, hex-encoded. */
export function canonicalHash(value: CanonicalValue): string {
  return sha256Hex(canonicalBytes(value));
}
