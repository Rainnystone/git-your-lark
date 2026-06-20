import { applyProposal, type ApplyProposalOptions } from "../lib/apply-runner.js";

export type ApplyCommandDependencies = Omit<ApplyProposalOptions, "proposalPath" | "configPath">;

export async function applyCommand(
  proposalPath: string,
  configPath: string,
  dependencies: ApplyCommandDependencies = {}
): Promise<number> {
  const result = await applyProposal({
    proposalPath,
    configPath,
    ...dependencies
  });

  console.log(JSON.stringify(result, null, 2));
  if (result.ok) {
    return 0;
  }
  return result.status === "failed" ? 1 : 2;
}
