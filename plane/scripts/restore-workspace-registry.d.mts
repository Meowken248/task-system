// Use the public contract shape: Hardhat and the root tooling may resolve
// separate ethers installations whose internal class brands are incompatible.
export interface RegistryContract {
  getAddress(): Promise<string>;
  readonly runner: unknown;
  readonly interface: unknown;
}
export interface WorkspaceRestorationPlan {
  slug: string;
  name: string;
  cid: string;
  owner: string;
  members: { address: string; role: number }[];
}
/** Registry ABI connected to a signer; dynamic contract methods are resolved by ethers. */
export function restoreWorkspaceOnRegistry(
  registry: RegistryContract,
  plan: WorkspaceRestorationPlan,
  send: (operation: string, method: string, args: (string | number)[]) => Promise<unknown>
): Promise<{ slug: string; members: number; verified: true }>;
