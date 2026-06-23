import YAML from "yaml";
import { z } from "zod";

export const PublishConfigSchema = z.object({
  remoteFolderToken: z.string().trim().min(1, "remoteFolderToken is required"),
  remoteFolderUrl: z.string().optional()
}).strict();

export const PullSourceConfigSchema = z.object({
  type: z.enum(["doc", "folder", "wiki_node"]),
  tokenOrUrl: z.string().trim().min(1)
}).strict();

export const PullConfigSchema = z.object({
  source: PullSourceConfigSchema,
  outputDir: z.string().default("."),
  linkMode: z.enum(["obsidian-wiki"]).default("obsidian-wiki"),
  frontmatter: z.enum(["minimal"]).default("minimal"),
  conflictPolicy: z.enum(["stop"]).default("stop"),
  remoteMissingPolicy: z.enum(["keep-local"]).default("keep-local"),
  assetPolicy: z.object({
    mode: z.enum(["per-document-folder"]).default("per-document-folder"),
    directoryName: z.string().trim().min(1).default("assets")
  }).strict().default({}),
  namingRules: z.array(z.object({
    match: z.object({
      title: z.string().optional(),
      token: z.string().optional(),
      wikiNodeToken: z.string().optional()
    }).strict(),
    localPath: z.string().trim().min(1)
  }).strict()).default([])
}).strict();

export const ConfigSchema = z.object({
  workspaceRoot: z.string().default("."),
  remoteFolderToken: z.string().trim().min(1, "remoteFolderToken is required").optional(),
  remoteFolderUrl: z.string().optional(),
  publish: PublishConfigSchema.optional(),
  pull: PullConfigSchema.optional(),
  include: z.array(z.string()).default(["**/*.md"]),
  exclude: z.array(z.string()).default([
    "node_modules/**",
    ".git/**",
    ".git-your-lark/**"
  ]),
  statePath: z.string().default(".git-your-lark/state.json"),
  proposalDir: z.string().default(".git-your-lark/proposals"),
  titleMode: z.enum(["stem", "path"]).default("stem"),
  referenceMode: z.enum(["lark-doc-cite", "url-link"]).default("lark-doc-cite"),
  attachmentPolicy: z.enum(["upload-supported", "warn-only", "block"]).default("upload-supported"),
  conflictPolicy: z.enum(["stop"]).default("stop"),
  overwritePolicy: z.enum(["explicit-only", "allow"]).default("explicit-only"),
  rateLimit: z.object({
    writeDelayMs: z.number().int().min(0).default(5000)
  }).strict().default({})
}).strict();

export type GitYourLarkConfig = z.infer<typeof ConfigSchema>;

export const defaultConfig = ConfigSchema.parse({
  remoteFolderToken: "placeholder"
});

export function parseConfig(source: string): GitYourLarkConfig {
  const raw = YAML.parse(source) ?? {};
  return ConfigSchema.parse(raw);
}

export interface RequiredPublishConfig {
  remoteFolderToken: string;
  remoteFolderUrl?: string;
}

export function requirePublishConfig(config: GitYourLarkConfig): RequiredPublishConfig {
  const remoteFolderToken = config.publish?.remoteFolderToken ?? config.remoteFolderToken;
  const remoteFolderUrl = config.publish?.remoteFolderUrl ?? config.remoteFolderUrl;
  if (!remoteFolderToken?.trim()) {
    throw new Error("Missing publish remote folder token. Add remoteFolderToken or publish.remoteFolderToken.");
  }
  return {
    remoteFolderToken: remoteFolderToken.trim(),
    ...(remoteFolderUrl ? { remoteFolderUrl } : {})
  };
}

export function requirePullConfig(config: GitYourLarkConfig): NonNullable<GitYourLarkConfig["pull"]> {
  if (!config.pull) {
    throw new Error("Missing pull config. Add pull.source.type and pull.source.tokenOrUrl.");
  }
  return config.pull;
}
