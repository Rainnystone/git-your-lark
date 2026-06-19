import { z } from "zod";
import { readJson, writeJson } from "./fs-utils.js";

export interface RemoteDocumentState {
  path: string;
  title: string;
  token: string;
  url: string;
  remoteRevision?: string;
  remoteModifiedTime?: string;
  localHash: string;
}

export interface AttachmentState {
  localPath: string;
  remoteToken: string;
  remoteUrl?: string;
  hash: string;
}

export interface GitYourLarkState {
  version: 1;
  remoteFolderToken: string;
  remoteFolderUrl?: string;
  documents: Record<string, RemoteDocumentState>;
  attachments: Record<string, AttachmentState>;
  lastAppliedProposalId?: string;
}

const RemoteDocumentStateSchema = z.object({
  path: z.string(),
  title: z.string(),
  token: z.string(),
  url: z.string(),
  remoteRevision: z.string().optional(),
  remoteModifiedTime: z.string().optional(),
  localHash: z.string()
}).strict();

const AttachmentStateSchema = z.object({
  localPath: z.string(),
  remoteToken: z.string(),
  remoteUrl: z.string().optional(),
  hash: z.string()
}).strict();

const GitYourLarkStateSchema = z.object({
  version: z.literal(1),
  remoteFolderToken: z.string(),
  remoteFolderUrl: z.string().optional(),
  documents: z.record(RemoteDocumentStateSchema),
  attachments: z.record(AttachmentStateSchema),
  lastAppliedProposalId: z.string().optional()
}).strict();

export function emptyState(remoteFolderToken: string, remoteFolderUrl?: string): GitYourLarkState {
  return {
    version: 1,
    remoteFolderToken,
    ...(remoteFolderUrl ? { remoteFolderUrl } : {}),
    documents: {},
    attachments: {}
  };
}

export async function loadState(path: string, remoteFolderToken: string): Promise<GitYourLarkState> {
  try {
    const parsed = GitYourLarkStateSchema.safeParse(await readJson(path));
    if (!parsed.success) {
      throw new Error(`Invalid git-your-lark state: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyState(remoteFolderToken);
    }
    throw error;
  }
}

export async function saveState(path: string, state: GitYourLarkState): Promise<void> {
  await writeJson(path, state);
}
