import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
  type KeyObject,
} from "node:crypto";

export interface KeyPair {
  /** Raw 32-byte Ed25519 public key, hex-encoded — used as the capsule `agent_id`. */
  publicKeyHex: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export function generateAgentKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey, publicKeyHex: rawPublicKeyHex(publicKey) };
}

/** Extract the raw 32-byte Ed25519 public key as hex from a KeyObject. */
export function rawPublicKeyHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) throw new Error("not an Ed25519 (OKP) public key");
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

/** Reconstruct an Ed25519 public KeyObject from a raw 32-byte hex key. */
export function publicKeyFromHex(hex: string): KeyObject {
  const x = Buffer.from(hex, "hex").toString("base64url");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}

export function signBytes(privateKey: KeyObject, bytes: Uint8Array): string {
  // Ed25519 requires a null algorithm (the curve fixes the hash).
  return nodeSign(null, bytes, privateKey).toString("hex");
}

export function verifyBytes(
  publicKey: KeyObject | string,
  bytes: Uint8Array,
  signatureHex: string,
): boolean {
  const key = typeof publicKey === "string" ? publicKeyFromHex(publicKey) : publicKey;
  try {
    return nodeVerify(null, bytes, key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
