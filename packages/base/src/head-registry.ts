import { createPublicClient, createWalletClient, http, parseAbi, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { toBytes32 } from "./anchor-store.js";

export const HEAD_REGISTRY_ABI = parseAbi([
  "function commitHead(bytes32 agentId, uint64 seq, bytes32 headLeaf)",
  "function getHead(bytes32 agentId) view returns (address owner, uint64 seq, bytes32 headLeaf, uint64 blockNumber, uint64 timestamp)",
]);

const DEFAULT_RPC_URL = "https://sepolia.base.org";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface BaseHeadRegistryOptions {
  registryAddress: Hex;
  rpcUrl?: string;
  /** Required only for `commitHead` (the head owner). */
  privateKey?: Hex;
}

export interface HeadCommit {
  owner: string;
  seq: number;
  /** 64-hex (no 0x) — the leaf of the agent's latest committed capsule. */
  headLeaf: string;
  block: number;
  timestamp: number;
}

/**
 * On-chain per-agent chain-head registry (`HeadRegistry`). Reading (`getHead`) is keyless; committing
 * a head needs the owner's key. A verifier compares a presented chain's head to the committed one to
 * reject a withheld tail (tail-truncation).
 */
export class BaseHeadRegistry {
  private readonly address: Hex;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly account?: ReturnType<typeof privateKeyToAccount>;

  constructor(options: BaseHeadRegistryOptions) {
    this.address = options.registryAddress;
    const transport = http(options.rpcUrl ?? process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_RPC_URL);
    this.publicClient = createPublicClient({ transport });
    if (options.privateKey) {
      this.account = privateKeyToAccount(options.privateKey);
      this.walletClient = createWalletClient({ account: this.account, transport });
    }
  }

  /** The committed head for an agent, or null if none has been committed. */
  async getHead(agentId: string): Promise<HeadCommit | null> {
    const [owner, seq, headLeaf, blockNumber, timestamp] = await this.publicClient.readContract({
      address: this.address,
      abi: HEAD_REGISTRY_ABI,
      functionName: "getHead",
      args: [toBytes32(agentId)],
    });
    if (owner.toLowerCase() === ZERO_ADDRESS) return null;
    return {
      owner,
      seq: Number(seq),
      headLeaf: headLeaf.slice(2),
      block: Number(blockNumber),
      timestamp: Number(timestamp) * 1000,
    };
  }

  /** Commit (or advance) an agent's head. Requires the owner key; `seq` must strictly increase. */
  async commitHead(agentId: string, seq: number, headLeaf: string): Promise<void> {
    if (!this.walletClient || !this.account) {
      throw new Error("commitHead requires a privateKey (the head owner)");
    }
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: HEAD_REGISTRY_ABI,
      functionName: "commitHead",
      args: [toBytes32(agentId), BigInt(seq), toBytes32(headLeaf)],
      account: this.account,
      chain: baseSepolia,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
  }
}
