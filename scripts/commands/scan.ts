import { dirname, join, resolve } from "node:path";
import { parseConfig } from "../lib/config.js";
import { readUtf8, writeJson } from "../lib/fs-utils.js";
import { scanLocalWorkspace as defaultScanLocalWorkspace, type LocalManifest, type LocalScanInput } from "../lib/local-scan.js";
import { scanRemoteFolder as defaultScanRemoteFolder, type RemoteManifest } from "../lib/remote-scan.js";
import { loadState as defaultLoadState, type GitYourLarkState } from "../lib/state.js";

export interface ScanManifest {
  local: LocalManifest;
  remote: RemoteManifest;
  state: GitYourLarkState;
}

export interface ScanCommandDependencies {
  scanLocalWorkspace?: (input: LocalScanInput) => Promise<LocalManifest>;
  scanRemoteFolder?: (folderToken: string) => Promise<RemoteManifest>;
  loadState?: (path: string, remoteFolderToken: string) => Promise<GitYourLarkState>;
}

export async function scanCommand(configPath: string, dependencies: ScanCommandDependencies = {}): Promise<number> {
  const scanLocalWorkspace = dependencies.scanLocalWorkspace ?? defaultScanLocalWorkspace;
  const scanRemoteFolder = dependencies.scanRemoteFolder ?? defaultScanRemoteFolder;
  const loadState = dependencies.loadState ?? defaultLoadState;
  const resolvedConfigPath = resolve(configPath);
  const configDir = dirname(resolvedConfigPath);
  const config = parseConfig(await readUtf8(resolvedConfigPath));
  const workspaceRoot = resolve(configDir, config.workspaceRoot);

  const local = await scanLocalWorkspace({
    workspaceRoot,
    include: config.include,
    exclude: config.exclude
  });
  const remote = await scanRemoteFolder(config.remoteFolderToken);
  const state = await loadState(resolve(workspaceRoot, config.statePath), config.remoteFolderToken);

  await writeJson(join(workspaceRoot, ".git-your-lark", "manifest.json"), {
    local,
    remote,
    state
  } satisfies ScanManifest);

  console.log(`Scanned ${local.documents.length} local documents, ${local.attachments.length} local attachments, ${remote.entries.length} remote entries.`);
  return 0;
}
