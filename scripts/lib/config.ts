import YAML from "yaml";
import { z } from "zod";

export const ConfigSchema = z.object({
  workspaceRoot: z.string().default("."),
  remoteFolderToken: z.string().trim().min(1, "remoteFolderToken is required"),
  remoteFolderUrl: z.string().optional(),
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
    writeDelayMs: z.number().int().min(0).default(5000),
    retries: z.number().int().min(0).default(4)
  }).default({})
}).strict();

export type GitYourLarkConfig = z.infer<typeof ConfigSchema>;

export const defaultConfig = ConfigSchema.parse({
  remoteFolderToken: "placeholder"
});

export function parseConfig(source: string): GitYourLarkConfig {
  const raw = YAML.parse(source) ?? {};
  return ConfigSchema.parse(raw);
}
