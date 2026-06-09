import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { generateAgentKeyPair, rawPublicKeyHex, type KeyPair, type SignedCapsule } from "@trackproof/core";

/**
 * A local, file-backed agent store: a persistent Ed25519 key (test-only) and the
 * append-only capsule chain. Used by the SDK/CLI so a chain survives across emits.
 */
export interface AgentStore {
  home: string;
  keyPair: KeyPair;
}

/** Open (or create) the store at `home`, loading or generating the agent key. */
export function openStore(home: string): AgentStore {
  mkdirSync(home, { recursive: true });
  const keyPath = join(home, "agent.key");
  if (existsSync(keyPath)) {
    const privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
    const publicKey = createPublicKey(privateKey);
    return { home, keyPair: { privateKey, publicKey, publicKeyHex: rawPublicKeyHex(publicKey) } };
  }
  const keyPair = generateAgentKeyPair();
  writeFileSync(keyPath, keyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  return { home, keyPair };
}

function chainPath(store: AgentStore): string {
  return join(store.home, "chain.jsonl");
}

export function readChain(store: AgentStore): SignedCapsule[] {
  const path = chainPath(store);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SignedCapsule);
}

export function lastCapsule(store: AgentStore): SignedCapsule | null {
  const chain = readChain(store);
  return chain.length > 0 ? chain[chain.length - 1]! : null;
}

export function appendCapsuleToStore(store: AgentStore, capsule: SignedCapsule): void {
  appendFileSync(chainPath(store), JSON.stringify(capsule) + "\n");
}
