import { dirname, join, resolve } from "node:path";
import { parseConfig, requirePublishConfig } from "../lib/config.js";
import { readUtf8, writeJson, writeUtf8 } from "../lib/fs-utils.js";
import { scanLocalWorkspace as defaultScanLocalWorkspace, type LocalManifest, type LocalScanInput } from "../lib/local-scan.js";
import { buildProposal, renderProposalMarkdown } from "../lib/proposal.js";
import { scanRemoteFolder as defaultScanRemoteFolder, type RemoteManifest } from "../lib/remote-scan.js";
import { loadState as defaultLoadState, type GitYourLarkState } from "../lib/state.js";

export interface ProposalCommandDependencies {
  scanLocalWorkspace?: (input: LocalScanInput) => Promise<LocalManifest>;
  scanRemoteFolder?: (folderToken: string) => Promise<RemoteManifest>;
  loadState?: (path: string, remoteFolderToken: string) => Promise<GitYourLarkState>;
  now?: () => Date;
}

export async function proposalCommand(configPath: string, dependencies: ProposalCommandDependencies = {}): Promise<number> {
  const scanLocalWorkspace = dependencies.scanLocalWorkspace ?? defaultScanLocalWorkspace;
  const scanRemoteFolder = dependencies.scanRemoteFolder ?? defaultScanRemoteFolder;
  const loadState = dependencies.loadState ?? defaultLoadState;
  const now = dependencies.now ?? (() => new Date());
  const resolvedConfigPath = resolve(configPath);
  const configDir = dirname(resolvedConfigPath);
  const config = parseConfig(await readUtf8(resolvedConfigPath));
  const publishConfig = requirePublishConfig(config);
  const workspaceRoot = resolve(configDir, config.workspaceRoot);

  const local = await scanLocalWorkspace({
    workspaceRoot,
    include: config.include,
    exclude: config.exclude,
    titleMode: config.titleMode
  });
  const remote = await scanRemoteFolder(publishConfig.remoteFolderToken);
  const state = await loadState(resolve(workspaceRoot, config.statePath), publishConfig.remoteFolderToken);
  const proposal = buildProposal({
    local,
    remote,
    state,
    attachmentPolicy: config.attachmentPolicy,
    now: now()
  });
  const proposalDir = resolve(workspaceRoot, config.proposalDir);
  const jsonPath = join(proposalDir, `${proposal.id}.json`);
  const markdownPath = join(proposalDir, `${proposal.id}.md`);

  await writeJson(jsonPath, proposal);
  await writeUtf8(markdownPath, renderProposalMarkdown(proposal));

  console.log(`Wrote proposal JSON: ${jsonPath}`);
  console.log(`Wrote proposal Markdown: ${markdownPath}`);
  return proposal.blockers.length === 0 ? 0 : 2;
}
