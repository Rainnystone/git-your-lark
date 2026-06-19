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
    return await readJson<GitYourLarkState>(path);
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
