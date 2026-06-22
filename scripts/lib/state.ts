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

export interface PullSourceState {
  type: "doc" | "folder" | "wiki_node";
  tokenOrUrl: string;
  sourceUrl?: string;
  remoteTitle?: string;
  remoteRevision?: string;
  remoteModifiedTime?: string;
  lastPulledAt?: string;
}

export interface PullDocumentState {
  docToken: string;
  wikiNodeToken?: string;
  sourceUrl?: string;
  remoteTitle: string;
  remotePath: string;
  localPath: string;
  remoteRevision?: string;
  remoteModifiedTime?: string;
  localHash: string;
  assetPaths: string[];
}

export interface PullAssetState {
  sourceToken?: string;
  sourceUrl?: string;
  localPath: string;
  ownerDocToken: string;
  hash: string;
}

export interface GitYourLarkRootState {
  version: 2;
  publish: GitYourLarkState;
  pull: {
    sources: Record<string, PullSourceState>;
    documents: Record<string, PullDocumentState>;
    assets: Record<string, PullAssetState>;
  };
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

const PullSourceStateSchema = z.object({
  type: z.enum(["doc", "folder", "wiki_node"]),
  tokenOrUrl: z.string(),
  sourceUrl: z.string().optional(),
  remoteTitle: z.string().optional(),
  remoteRevision: z.string().optional(),
  remoteModifiedTime: z.string().optional(),
  lastPulledAt: z.string().optional()
}).strict();

const PullDocumentStateSchema = z.object({
  docToken: z.string(),
  wikiNodeToken: z.string().optional(),
  sourceUrl: z.string().optional(),
  remoteTitle: z.string(),
  remotePath: z.string(),
  localPath: z.string(),
  remoteRevision: z.string().optional(),
  remoteModifiedTime: z.string().optional(),
  localHash: z.string(),
  assetPaths: z.array(z.string())
}).strict();

const PullAssetStateSchema = z.object({
  sourceToken: z.string().optional(),
  sourceUrl: z.string().optional(),
  localPath: z.string(),
  ownerDocToken: z.string(),
  hash: z.string()
}).strict();

const GitYourLarkRootStateSchema = z.object({
  version: z.literal(2),
  publish: GitYourLarkStateSchema,
  pull: z.object({
    sources: z.record(PullSourceStateSchema),
    documents: z.record(PullDocumentStateSchema),
    assets: z.record(PullAssetStateSchema)
  }).strict()
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

function emptyPullState(): GitYourLarkRootState["pull"] {
  return {
    sources: {},
    documents: {},
    assets: {}
  };
}

function emptyRootState(remoteFolderToken = "", remoteFolderUrl?: string): GitYourLarkRootState {
  return {
    version: 2,
    publish: emptyState(remoteFolderToken, remoteFolderUrl),
    pull: emptyPullState()
  };
}

function migratePublishState(publish: GitYourLarkState): GitYourLarkRootState {
  return {
    version: 2,
    publish,
    pull: emptyPullState()
  };
}

function isEmptyPublishState(state: GitYourLarkState): boolean {
  return !state.remoteFolderToken.trim()
    && !state.remoteFolderUrl
    && Object.keys(state.documents).length === 0
    && Object.keys(state.attachments).length === 0
    && !state.lastAppliedProposalId;
}

export async function loadRootState(path: string, remoteFolderToken?: string): Promise<GitYourLarkRootState> {
  try {
    const value = await readJson(path);
    const root = GitYourLarkRootStateSchema.safeParse(value);
    if (root.success) {
      return root.data;
    }

    const publish = GitYourLarkStateSchema.safeParse(value);
    if (publish.success) {
      return migratePublishState(publish.data);
    }

    throw new Error(`Invalid git-your-lark state: ${root.error.message}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyRootState(remoteFolderToken);
    }
    throw error;
  }
}

export async function saveRootState(path: string, state: GitYourLarkRootState): Promise<void> {
  await writeJson(path, state);
}

export async function loadPublishState(path: string, remoteFolderToken: string): Promise<GitYourLarkState> {
  const root = await loadRootState(path, remoteFolderToken);
  const trimmedRemoteFolderToken = remoteFolderToken.trim();
  if (trimmedRemoteFolderToken && isEmptyPublishState(root.publish)) {
    return emptyState(trimmedRemoteFolderToken);
  }
  return root.publish;
}

export async function savePublishState(path: string, state: GitYourLarkState): Promise<void> {
  try {
    const value = await readJson(path);
    const root = GitYourLarkRootStateSchema.safeParse(value);
    if (root.success) {
      await saveRootState(path, {
        ...root.data,
        publish: state
      });
      return;
    }

    const publish = GitYourLarkStateSchema.safeParse(value);
    if (publish.success) {
      await writeJson(path, state);
      return;
    }

    throw new Error(`Invalid git-your-lark state: ${root.error.message}`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await writeJson(path, state);
      return;
    }
    throw error;
  }
}

export async function loadState(path: string, remoteFolderToken: string): Promise<GitYourLarkState> {
  return loadPublishState(path, remoteFolderToken);
}

export async function saveState(path: string, state: GitYourLarkState): Promise<void> {
  await savePublishState(path, state);
}
