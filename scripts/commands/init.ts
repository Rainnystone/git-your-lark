import { existsSync } from "node:fs";
import { ConfigSchema } from "../lib/config.js";
import { writeUtf8 } from "../lib/fs-utils.js";
import { extractJson, runCommand, type CommandResult } from "../lib/lark-cli.js";

export interface InitConfigInput {
  remoteFolderToken?: string;
  remoteFolderUrl?: string;
  workspaceRoot: string;
  pullSourceType?: "doc" | "folder" | "wiki_node";
  pullSourceTokenOrUrl?: string;
  pullOutputDir?: string;
}

export interface CreateFolderInput {
  folderName: string;
  parentFolderToken?: string;
}

export interface CreatedFolder {
  remoteFolderToken: string;
  remoteFolderUrl?: string;
}

export interface InitCommandOptions {
  remoteFolderToken?: string;
  remoteFolderUrl?: string;
  createRemoteFolder?: boolean;
  folderName?: string;
  parentFolderToken?: string;
  workspaceRoot?: string;
  pullSourceType?: "doc" | "folder" | "wiki_node";
  pullSourceTokenOrUrl?: string;
  pullOutputDir?: string;
  outputPath?: string;
  force?: boolean;
  run?: (command: string, args: string[], cwd?: string) => Promise<CommandResult>;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function renderInitConfig(input: InitConfigInput): string {
  const hasPublishConfig = Boolean(input.remoteFolderToken?.trim());
  const hasPullConfig = Boolean(input.pullSourceType && input.pullSourceTokenOrUrl?.trim());
  const lines = [
    `workspaceRoot: ${yamlString(input.workspaceRoot)}`,
    ...(hasPublishConfig ? [`remoteFolderToken: ${yamlString(input.remoteFolderToken!)}`] : []),
    ...(hasPublishConfig && input.remoteFolderUrl ? [`remoteFolderUrl: ${yamlString(input.remoteFolderUrl)}`] : []),
    ...(hasPullConfig ? [
      "pull:",
      "  source:",
      `    type: ${yamlString(input.pullSourceType!)}`,
      `    tokenOrUrl: ${yamlString(input.pullSourceTokenOrUrl!)}`,
      `  outputDir: ${yamlString(input.pullOutputDir ?? ".")}`
    ] : []),
    "include:",
    '  - "**/*.md"',
    "exclude:",
    '  - "node_modules/**"',
    '  - ".git/**"',
    '  - ".git-your-lark/**"',
    "statePath: .git-your-lark/state.json",
    "proposalDir: .git-your-lark/proposals",
    "titleMode: stem",
    "referenceMode: lark-doc-cite",
    "attachmentPolicy: upload-supported",
    "conflictPolicy: stop",
    "overwritePolicy: explicit-only",
    "rateLimit:",
    "  writeDelayMs: 5000",
    ""
  ];

  ConfigSchema.parse({
    workspaceRoot: input.workspaceRoot,
    ...(hasPublishConfig ? { remoteFolderToken: input.remoteFolderToken } : {}),
    ...(hasPublishConfig && input.remoteFolderUrl ? { remoteFolderUrl: input.remoteFolderUrl } : {}),
    ...(hasPullConfig ? {
      pull: {
        source: {
          type: input.pullSourceType,
          tokenOrUrl: input.pullSourceTokenOrUrl
        },
        outputDir: input.pullOutputDir ?? "."
      }
    } : {})
  });

  return lines.join("\n");
}

export function buildCreateFolderArgs(input: CreateFolderInput): string[] {
  return [
    "drive",
    "+create-folder",
    "--as",
    "user",
    ...(input.parentFolderToken ? ["--folder-token", input.parentFolderToken] : []),
    "--name",
    input.folderName,
    "--json"
  ];
}

export function extractCreatedFolder(value: unknown): CreatedFolder {
  const root = value as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const remoteFolderToken = String(data.folder_token ?? data.token ?? "");
  const remoteFolderUrl = data.url ? String(data.url) : undefined;

  if (!remoteFolderToken) {
    throw new Error("lark-cli drive +create-folder did not return folder_token.");
  }

  return {
    remoteFolderToken,
    ...(remoteFolderUrl ? { remoteFolderUrl } : {})
  };
}

async function resolveRemoteFolder(options: Required<Pick<InitCommandOptions, "createRemoteFolder">> & InitCommandOptions): Promise<CreatedFolder | null> {
  if (options.remoteFolderToken?.trim() && options.createRemoteFolder) {
    console.error("Choose either --remote-folder-token or --create-remote-folder, not both.");
    return null;
  }

  if (options.remoteFolderToken?.trim()) {
    return {
      remoteFolderToken: options.remoteFolderToken.trim(),
      ...(options.remoteFolderUrl ? { remoteFolderUrl: options.remoteFolderUrl } : {})
    };
  }

  if (!options.createRemoteFolder) {
    console.error("Missing --remote-folder-token. For first publish, pass --create-remote-folder --folder-name <name>.");
    return null;
  }

  if (!options.folderName?.trim()) {
    console.error("Missing --folder-name for --create-remote-folder.");
    return null;
  }

  const run = options.run ?? runCommand;
  const result = await run("lark-cli", buildCreateFolderArgs({
    folderName: options.folderName,
    parentFolderToken: options.parentFolderToken
  }));

  if (result.code !== 0) {
    console.error(`${result.stdout}${result.stderr}`);
    return null;
  }

  try {
    return extractCreatedFolder(extractJson(result.stdout));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function initCommand(options: InitCommandOptions): Promise<number> {
  const outputPath = options.outputPath ?? "git-your-lark.yml";
  const workspaceRoot = options.workspaceRoot ?? ".";
  const force = options.force ?? false;
  const hasPullIntent = Boolean(options.pullSourceType || options.pullSourceTokenOrUrl || options.pullOutputDir);
  const hasPublishIntent = Boolean(
    options.remoteFolderToken?.trim()
    || options.remoteFolderUrl?.trim()
    || options.createRemoteFolder
    || options.folderName?.trim()
    || options.parentFolderToken?.trim()
  );

  if (existsSync(outputPath) && !force) {
    console.error(`${outputPath} already exists. Pass --force to overwrite it.`);
    return 1;
  }

  if (hasPullIntent && !options.pullSourceType) {
    console.error("Missing --pull-source-type for pull init.");
    return 1;
  }

  if (hasPullIntent && !options.pullSourceTokenOrUrl?.trim()) {
    console.error("Missing --pull-source for pull init.");
    return 1;
  }

  const remote = hasPublishIntent || !hasPullIntent
    ? await resolveRemoteFolder({
      ...options,
      createRemoteFolder: options.createRemoteFolder ?? false
    })
    : null;

  if ((hasPublishIntent || !hasPullIntent) && !remote) return 1;

  await writeUtf8(outputPath, renderInitConfig({
    workspaceRoot,
    remoteFolderToken: remote?.remoteFolderToken,
    remoteFolderUrl: remote?.remoteFolderUrl,
    pullSourceType: options.pullSourceType,
    pullSourceTokenOrUrl: options.pullSourceTokenOrUrl?.trim(),
    pullOutputDir: hasPullIntent ? (options.pullOutputDir ?? ".") : undefined
  }));
  console.log(`Created ${outputPath}`);
  return 0;
}
