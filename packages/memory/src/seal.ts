import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** An AES-256-GCM sealed payload (hex-encoded iv / auth tag / ciphertext). */
export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

/** Seal `plaintext` under a 32-byte key with AES-256-GCM. */
export function sealBody(plaintext: string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: data.toString("hex") };
}

/** Reverse `sealBody`; throws if the key is wrong or the ciphertext was tampered with. */
export function unsealBody(sealed: Sealed, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "hex"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "hex")), decipher.final()]).toString("utf8");
}
