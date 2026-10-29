import type { BaseContract, Signer } from "ethers";
import type { ChainBindings } from "./service.mjs";
export function createChainAdapters(options: {
  registry: BaseContract;
  verification: BaseContract;
  signer: Signer;
  confirmations?: number;
  receiptTimeoutMs?: number;
}): Promise<ChainBindings>;
