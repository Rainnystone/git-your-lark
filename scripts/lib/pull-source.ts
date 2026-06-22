import { extractJson, runCommand, type CommandResult } from "./lark-cli.js";
import type {
  PullDocumentSourceKind,
  PullRemoteDocument,
  PullRemoteIndex,
  PullScanResult,
  PullScanWarning
} from "./pull-types.js";

type CommandRunner = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;
type PullSourceInput = PullScanResult["source"];

interface DriveItem {
  title: string;
  token: string;
  type: string;
  url?: string;
  remotePath?: string;
  modifiedTime?: string;
}

interface DriveListPage {
  files?: unknown[];
  items?: unknown[];
  has_more?: boolean;
  next_page_token?: string;
}

interface WikiNode {
  title: string;
  nodeToken: string;
  docToken: string;
  objType: string;
  nodeType: string;
  hasChild: boolean;
  spaceId?: string;
  url?: string;
  modifiedTime?: string;
}

interface DuplicateTracker {
  remotePaths: Set<string>;
  docTokens: Set<string>;
}

export async function scanPullSource(
  source: PullSourceInput,
  run: CommandRunner = runCommand
): Promise<PullScanResult> {
  if (source.type === "doc") {
    return resolveSingleDocSource(source.tokenOrUrl, run);
  }
  if (source.type === "folder") {
    return scanDriveFolderSource(source.tokenOrUrl, run);
  }
  if (source.type === "wiki_node") {
    return scanWikiNodeSource(source.tokenOrUrl, run);
  }

  throw new Error(`Unsupported pull source type: ${String(source.type)}`);
}

export async function resolveSingleDocSource(
  tokenOrUrl: string,
  run: CommandRunner = runCommand
): Promise<PullScanResult> {
  const item = toDriveItem(await inspectDriveDocument(tokenOrUrl, run));
  if (!isPullableType(item.type)) {
    throw new Error(`Unsupported document source type: ${item.type || "unknown"}`);
  }

  return {
    source: {
      type: "doc",
      tokenOrUrl,
      ...(item.title ? { title: item.title } : {})
    },
    documents: [toPullDocument("doc", item, item.title)],
    indexes: [],
    warnings: []
  };
}

export async function scanDriveFolderSource(
  tokenOrUrl: string,
  run: CommandRunner = runCommand
): Promise<PullScanResult> {
  const root = isUrl(tokenOrUrl) ? toDriveItem(await inspectDriveUrl(tokenOrUrl, run)) : undefined;
  const folderToken = root?.token || tokenOrUrl;
  const rootTitle = root?.title;
  const documents: PullRemoteDocument[] = [];
  const warnings: PullScanWarning[] = [];
  const duplicates = createDuplicateTracker();
  const folders: Array<{ token: string; path: string }> = [{ token: folderToken, path: rootTitle ?? "" }];

  for (let index = 0; index < folders.length; index += 1) {
    const folder = folders[index];
    const childFolders: Array<{ token: string; path: string }> = [];

    for (const item of await listDriveFolderItems(folder.token, run)) {
      const remotePath = joinRemotePath(folder.path, item.title);
      if (isPullableType(item.type)) {
        addDocument(documents, warnings, duplicates, toPullDocument("folder", item, remotePath), item.type);
      } else if (item.type === "folder") {
        childFolders.push({ token: item.token, path: remotePath });
      } else {
        warnings.push(toWarning(item));
      }
    }

    folders.push(...childFolders);
  }

  return {
    source: {
      type: "folder",
      tokenOrUrl,
      ...(rootTitle ? { title: rootTitle } : {})
    },
    documents,
    indexes: [],
    warnings
  };
}

export async function scanWikiNodeSource(
  tokenOrUrl: string,
  run: CommandRunner = runCommand
): Promise<PullScanResult> {
  const nodeToken = isUrl(tokenOrUrl) ? wikiNodeTokenFromInspect(await inspectDriveUrl(tokenOrUrl, run)) : tokenOrUrl;
  const rootNode = toWikiNode(await getWikiNode(nodeToken, run));
  const documents: PullRemoteDocument[] = [];
  const indexes: PullRemoteIndex[] = [];
  const warnings: PullScanWarning[] = [];
  const duplicates = createDuplicateTracker();

  const rootChildDocTokens = rootNode.hasChild
    ? await scanWikiChildren(rootNode, rootNode.title, run, documents, indexes, warnings, duplicates)
    : [];

  if (rootNode.hasChild && isPullableWikiNode(rootNode)) {
    indexes.unshift({
      title: rootNode.title,
      docToken: rootNode.docToken,
      wikiNodeToken: rootNode.nodeToken,
      remotePath: rootNode.title,
      childDocTokens: rootChildDocTokens
    });
  } else if (isPullableWikiNode(rootNode)) {
    addDocument(documents, warnings, duplicates, toWikiDocument(rootNode, rootNode.title), rootNode.objType);
  } else {
    warnings.push(toWarning(wikiNodeToWarningItem(rootNode, rootNode.hasChild ? rootNode.title : undefined)));
  }

  return {
    source: {
      type: "wiki_node",
      tokenOrUrl,
      ...(rootNode.title ? { title: rootNode.title } : {})
    },
    documents,
    indexes,
    warnings
  };
}

async function scanWikiChildren(
  parent: WikiNode,
  parentPath: string,
  run: CommandRunner,
  documents: PullRemoteDocument[],
  indexes: PullRemoteIndex[],
  warnings: PullScanWarning[],
  duplicates: DuplicateTracker
): Promise<string[]> {
  const children = await listWikiChildren(parent, run);
  const childDocTokens: string[] = [];

  for (const child of children) {
    const remotePath = joinRemotePath(parentPath, child.title);
    if (isPullableWikiNode(child)) {
      addDocument(documents, warnings, duplicates, toWikiDocument(child, remotePath), child.objType);
      childDocTokens.push(child.docToken);
    } else {
      warnings.push(toWarning(wikiNodeToWarningItem(child, child.hasChild ? remotePath : undefined)));
    }

    if (child.hasChild) {
      const descendantDocTokens = await scanWikiChildren(child, remotePath, run, documents, indexes, warnings, duplicates);
      if (isPullableWikiNode(child)) {
        indexes.push({
          title: child.title,
          docToken: child.docToken,
          wikiNodeToken: child.nodeToken,
          remotePath,
          childDocTokens: descendantDocTokens
        });
      }
    }
  }

  return childDocTokens;
}

async function inspectDriveDocument(tokenOrUrl: string, run: CommandRunner): Promise<unknown> {
  if (isUrl(tokenOrUrl)) {
    return inspectDriveUrl(tokenOrUrl, run);
  }

  const docxResult = await runInspectDriveCommand(tokenOrUrl, run, "docx");
  if (docxResult.code === 0) {
    return extractJson(docxResult.stdout);
  }

  const docResult = await runInspectDriveCommand(tokenOrUrl, run, "doc");
  if (docResult.code === 0) {
    return extractJson(docResult.stdout);
  }

  throw new Error(
    `lark-cli pull source inspect failed\n` +
      `docx stdout:\n${docxResult.stdout}\n` +
      `docx stderr:\n${docxResult.stderr}\n` +
      `doc stdout:\n${docResult.stdout}\n` +
      `doc stderr:\n${docResult.stderr}`
  );
}

async function inspectDriveUrl(tokenOrUrl: string, run: CommandRunner): Promise<unknown> {
  const result = await runInspectDriveCommand(tokenOrUrl, run);
  if (result.code !== 0) {
    throw new Error(`lark-cli pull source inspect failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return extractJson(result.stdout);
}

async function runInspectDriveCommand(
  tokenOrUrl: string,
  run: CommandRunner,
  type?: "doc" | "docx"
): Promise<CommandResult> {
  const args = [
    "drive",
    "+inspect",
    "--as",
    "user",
    "--url",
    tokenOrUrl,
    ...(type ? ["--type", type] : []),
    "--format",
    "json"
  ];
  return run("lark-cli", args);
}

async function listDriveFolderItems(folderToken: string, run: CommandRunner): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = {
      folder_token: folderToken,
      page_size: 200,
      ...(pageToken ? { page_token: pageToken } : {})
    };
    const page = extractListPage(
      await runJsonCommand(
        "lark-cli pull folder scan failed",
        "lark-cli",
        ["drive", "files", "list", "--as", "user", "--params", JSON.stringify(params), "--format", "json"],
        run
      )
    );

    items.push(...(page.files ?? page.items ?? []).map(toDriveItem));
    if (page.has_more) {
      if (!page.next_page_token?.trim()) {
        throw new Error("lark-cli pull folder scan failed: missing next_page_token while has_more is true.");
      }
      pageToken = page.next_page_token;
    } else {
      pageToken = undefined;
    }
  } while (pageToken);

  return items;
}

async function getWikiNode(nodeToken: string, run: CommandRunner): Promise<unknown> {
  return runJsonCommand(
    "lark-cli pull wiki node get failed",
    "lark-cli",
    ["wiki", "+node-get", "--as", "user", "--node-token", nodeToken, "--format", "json"],
    run
  );
}

async function listWikiChildren(parent: WikiNode, run: CommandRunner): Promise<WikiNode[]> {
  if (!parent.spaceId) {
    throw new Error(`lark-cli pull wiki node list failed: missing space_id for ${parent.nodeToken}`);
  }

  const value = await runJsonCommand(
    "lark-cli pull wiki node list failed",
    "lark-cli",
    [
      "wiki",
      "+node-list",
      "--as",
      "user",
      "--space-id",
      parent.spaceId,
      "--parent-node-token",
      parent.nodeToken,
      "--page-all",
      "--page-limit",
      "0",
      "--format",
      "json"
    ],
    run
  );

  return extractNodeList(value).map((node) => {
    const child = toWikiNode(node);
    return {
      ...child,
      spaceId: child.spaceId || parent.spaceId
    };
  });
}

async function runJsonCommand(
  message: string,
  command: string,
  args: string[],
  run: CommandRunner
): Promise<unknown> {
  const result = await run(command, args);
  if (result.code !== 0) {
    throw new Error(`${message}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  return extractJson(result.stdout);
}

function extractListPage(value: unknown): DriveListPage {
  const root = value as Record<string, unknown>;
  return (root.data ?? root) as DriveListPage;
}

function extractNodeList(value: unknown): unknown[] {
  const data = unwrapData(value) as Record<string, unknown>;
  const items = data.items ?? data.nodes ?? data.children ?? [];
  return Array.isArray(items) ? items : [];
}

function wikiNodeTokenFromInspect(value: unknown): string {
  const data = unwrapData(value) as Record<string, unknown>;
  const nested = data.wiki_node ?? data.wikiNode ?? data.wiki_node_info ?? data.wikiNodeInfo;
  if (nested !== undefined) {
    if (!isRecord(nested)) {
      throw new Error("lark-cli pull wiki inspect failed: wiki_node is not an object.");
    }

    const nestedToken = stringValue(nested.node_token ?? nested.wiki_node_token ?? nested.token);
    if (!nestedToken) {
      throw new Error("lark-cli pull wiki inspect failed: missing wiki_node.node_token.");
    }
    return nestedToken;
  }

  const fallbackToken = toWikiNode(value).nodeToken;
  if (!fallbackToken) {
    throw new Error("lark-cli pull wiki inspect failed: missing wiki node token.");
  }
  return fallbackToken;
}

function toDriveItem(value: unknown): DriveItem {
  const item = unwrapData(value) as Record<string, unknown>;
  return {
    title: stringValue(item.name ?? item.title),
    token: stringValue(item.token ?? item.file_token ?? item.obj_token ?? item.doc_token ?? item.folder_token),
    type: stringValue(item.type ?? item.file_type ?? item.obj_type),
    ...(item.url ? { url: String(item.url) } : {}),
    ...(item.modified_time || item.modifiedTime ? { modifiedTime: String(item.modified_time ?? item.modifiedTime) } : {})
  };
}

function toWikiNode(value: unknown): WikiNode {
  const node = unwrapNode(value) as Record<string, unknown>;
  return {
    title: stringValue(node.title ?? node.name),
    nodeToken: stringValue(node.node_token ?? node.wiki_node_token ?? node.token),
    docToken: stringValue(node.obj_token ?? node.doc_token ?? node.document_token),
    objType: stringValue(node.obj_type ?? node.type),
    nodeType: stringValue(node.node_type),
    hasChild: booleanValue(node.has_child ?? node.hasChild),
    ...(node.space_id || node.spaceId ? { spaceId: String(node.space_id ?? node.spaceId) } : {}),
    ...(node.url ? { url: String(node.url) } : {}),
    ...(node.modified_time || node.modifiedTime ? { modifiedTime: String(node.modified_time ?? node.modifiedTime) } : {})
  };
}

function unwrapData(value: unknown): unknown {
  const root = value as Record<string, unknown>;
  return root.data ?? root;
}

function unwrapNode(value: unknown): unknown {
  const data = unwrapData(value) as Record<string, unknown>;
  return data.node ?? data.item ?? data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPullableType(type: string): boolean {
  return type === "doc" || type === "docx";
}

function isPullableWikiNode(node: WikiNode): boolean {
  return isPullableType(node.objType) || (node.nodeType === "shortcut" && isPullableType(node.objType));
}

function createDuplicateTracker(): DuplicateTracker {
  return {
    remotePaths: new Set<string>(),
    docTokens: new Set<string>()
  };
}

function addDocument(
  documents: PullRemoteDocument[],
  warnings: PullScanWarning[],
  duplicates: DuplicateTracker,
  document: PullRemoteDocument,
  type: string
): void {
  documents.push(document);
  if (duplicates.remotePaths.has(document.remotePath)) {
    warnings.push({
      message: `Duplicate remote path: ${document.remotePath}`,
      title: document.title,
      type,
      token: document.docToken,
      remotePath: document.remotePath
    });
  } else {
    duplicates.remotePaths.add(document.remotePath);
  }

  if (duplicates.docTokens.has(document.docToken)) {
    warnings.push({
      message: `Duplicate document token: ${document.docToken}`,
      title: document.title,
      type,
      token: document.docToken,
      remotePath: document.remotePath
    });
  } else {
    duplicates.docTokens.add(document.docToken);
  }
}

function toPullDocument(sourceKind: PullDocumentSourceKind, item: DriveItem, remotePath: string): PullRemoteDocument {
  return {
    sourceKind,
    title: item.title,
    docToken: item.token,
    remotePath,
    ...(item.url ? { sourceUrl: item.url } : {}),
    ...(item.modifiedTime ? { modifiedTime: item.modifiedTime } : {})
  };
}

function toWikiDocument(node: WikiNode, remotePath: string): PullRemoteDocument {
  return {
    sourceKind: "wiki_node",
    title: node.title,
    docToken: node.docToken,
    wikiNodeToken: node.nodeToken,
    remotePath,
    ...(node.url ? { sourceUrl: node.url } : {}),
    ...(node.modifiedTime ? { modifiedTime: node.modifiedTime } : {})
  };
}

function wikiNodeToWarningItem(node: WikiNode, remotePath?: string): DriveItem {
  return {
    title: node.title,
    token: node.docToken,
    type: node.objType || node.nodeType,
    ...(node.url ? { url: node.url } : {}),
    ...(remotePath ? { remotePath } : {})
  };
}

function toWarning(item: DriveItem): PullScanWarning {
  return {
    message: `Skipping non-document item: ${item.title}`,
    ...(item.title ? { title: item.title } : {}),
    ...(item.type ? { type: item.type } : {}),
    ...(item.token ? { token: item.token } : {}),
    ...(item.url ? { url: item.url } : {}),
    ...(item.remotePath ? { remotePath: item.remotePath } : {})
  };
}

function joinRemotePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}
