import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { AnchorRecord, AnchorStore } from "@trackproof/core";

export const ANCHOR_ABI = parseAbi([
  "function submitRoot(bytes32 root)",
  "function getAnchor(bytes32 root) view returns (uint64 blockNumber, uint64 timestamp)",
  "function isAnchored(bytes32 root) view returns (bool)",
  "event RootAnchored(bytes32 indexed root, uint64 blockNumber, uint64 timestamp)",
]);

const DEFAULT_RPC_URL = "https://sepolia.base.org";

export interface BaseAnchorStoreOptions {
  /** Deployed Anchor contract address. */
  anchorAddress: Hex;
  /** RPC URL; defaults to BASE_SEPOLIA_RPC_URL or https://sepolia.base.org. */
  rpcUrl?: string;
  /** Required only for `submitRoot` (the operator/anchoring side). */
  privateKey?: Hex;
}

/** Convert a 64-hex root (with or without `0x`) to a bytes32 hex. */
export function toBytes32(root: string): Hex {
  const hex = root.startsWith("0x") ? root.slice(2) : root;
  if (hex.length !== 64) throw new Error(`expected a 32-byte hex root, got length ${hex.length}`);
  return `0x${hex}`;
}

/** Map an on-chain (blockNumber, seconds-timestamp) reading to an AnchorRecord (ms). */
export function toAnchorRecord(root: string, blockNumber: bigint, secondsTimestamp: bigint): AnchorRecord | null {
  if (secondsTimestamp === 0n) return null;
  return { root, block: Number(blockNumber), timestamp: Number(secondsTimestamp) * 1000 };
}

/**
 * On-chain AnchorStore backed by the deployed Base `Anchor` contract. Reads (`getByRoot`,
 * `getByBlock`) are **keyless** via a public RPC; `submitRoot` needs an operator private key.
 */
export class BaseAnchorStore implements AnchorStore {
  private readonly address: Hex;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;
  private readonly account?: ReturnType<typeof privateKeyToAccount>;

  constructor(options: BaseAnchorStoreOptions) {
    this.address = options.anchorAddress;
    const transport = http(options.rpcUrl ?? process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_RPC_URL);
    // No `chain` on the clients: reads (eth_call / getLogs) are chain-agnostic, and avoiding the
    // OP-stack chain formatters keeps the client types assignable. The chain is supplied per write.
    this.publicClient = createPublicClient({ transport });
    if (options.privateKey) {
      this.account = privateKeyToAccount(options.privateKey);
      this.walletClient = createWalletClient({ account: this.account, transport });
    }
  }

  async getByRoot(root: string): Promise<AnchorRecord | null> {
    const [blockNumber, timestamp] = await this.publicClient.readContract({
      address: this.address,
      abi: ANCHOR_ABI,
      functionName: "getAnchor",
      args: [toBytes32(root)],
    });
    return toAnchorRecord(root, blockNumber, timestamp);
  }

  async submitRoot(root: string): Promise<AnchorRecord> {
    if (!this.walletClient || !this.account) {
      throw new Error("submitRoot requires a privateKey (the operator/anchoring side)");
    }
    const existing = await this.getByRoot(root);
    if (existing) return existing;
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: ANCHOR_ABI,
      functionName: "submitRoot",
      args: [toBytes32(root)],
      account: this.account,
      chain: baseSepolia,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    const record = await this.getByRoot(root);
    if (!record) throw new Error("submitRoot did not produce an anchor record");
    return record;
  }

  async getByBlock(block: number): Promise<AnchorRecord | null> {
    const logs = await this.publicClient.getContractEvents({
      address: this.address,
      abi: ANCHOR_ABI,
      eventName: "RootAnchored",
      fromBlock: BigInt(block),
      toBlock: BigInt(block),
    });
    const args = logs[0]?.args;
    if (!args || args.root === undefined || args.blockNumber === undefined || args.timestamp === undefined) {
      return null;
    }
    return toAnchorRecord(args.root.slice(2), args.blockNumber, args.timestamp);
  }
}
