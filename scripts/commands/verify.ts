import { dirname, resolve } from "node:path";
import { parseConfig } from "../lib/config.js";
import { readUtf8 } from "../lib/fs-utils.js";
import { scanLocalWorkspace as defaultScanLocalWorkspace, type LocalManifest, type LocalScanInput } from "../lib/local-scan.js";
import { scanRemoteFolder as defaultScanRemoteFolder, type RemoteManifest } from "../lib/remote-scan.js";
import { verifyManifest } from "../lib/verify.js";

export interface VerifyCommandDependencies {
  scanLocalWorkspace?: (input: LocalScanInput) => Promise<LocalManifest>;
  scanRemoteFolder?: (folderToken: string) => Promise<RemoteManifest>;
}

export async function verifyCommand(configPath: string, dependencies: VerifyCommandDependencies = {}): Promise<number> {
  const scanLocalWorkspace = dependencies.scanLocalWorkspace ?? defaultScanLocalWorkspace;
  const scanRemoteFolder = dependencies.scanRemoteFolder ?? defaultScanRemoteFolder;
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
  const result = verifyManifest(local, remote);

  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}
