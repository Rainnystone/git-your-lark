import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseConfig, type GitYourLarkConfig } from "./config.js";
import { readJson, readUtf8, writeJson } from "./fs-utils.js";
import { extractJson, runCommand, type CommandResult } from "./lark-cli.js";
import { planMarkdownWrite } from "./patch-plan.js";
import type { ProposalAction, SyncProposal } from "./proposal.js";
import { scanRemoteFolder as defaultScanRemoteFolder, type RemoteEntry, type RemoteManifest } from "./remote-scan.js";
import { renderMarkdownForLark, type ReferenceTarget } from "./render.js";
import {
  loadState as defaultLoadState,
  saveState as defaultSaveState,
  type GitYourLarkState,
  type RemoteDocumentState
} from "./state.js";

export type ApplyRunner = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

export type ApplyPhaseName = "create-placeholders" | "write-documents" | "insert-attachments";

export interface ApplyPhase {
  name: ApplyPhaseName;
  actions: ProposalAction[];
}

export type ApplyStatus = "applied" | "blocked" | "conflict" | "failed";

export interface ApplyResult {
  ok: boolean;
  status: ApplyStatus;
  problems: string[];
  journalPath: string;
}

export interface ApplyProposalOptions {
  proposalPath: string;
  configPath: string;
  run?: ApplyRunner;
  scanRemoteFolder?: (folderToken: string) => Promise<RemoteManifest>;
  loadState?: (path: string, remoteFolderToken: string) => Promise<GitYourLarkState>;
  saveState?: (path: string, state: GitYourLarkState) => Promise<void>;
  now?: () => Date;
}

interface ApplyJournal {
  proposalId: string;
  startedAt: string;
  status: ApplyStatus | "running";
  events: ApplyJournalEvent[];
}

interface ApplyJournalEvent {
  at: string;
  step: string;
  action?: ProposalAction;
  message?: string;
  problems?: string[];
  createdToken?: string;
  remoteToken?: string;
}

interface RemoteDocumentResult {
  token: string;
  url?: string;
  modifiedTime?: string;
}

interface RemoteMediaResult {
  token?: string;
  url?: string;
}

export function planApplySequence(proposal: SyncProposal): ApplyPhase[] {
  const phases: ApplyPhase[] = [];
  const createDocuments = proposal.actions.filter(isCreateDocumentAction);
  const writeDocuments = proposal.actions.filter(isDocumentWriteAction);
  const uploadAttachments = proposal.actions.filter(isUploadAttachmentAction);

  if (createDocuments.length > 0) {
    phases.push({ name: "create-placeholders", actions: createDocuments });
  }
  if (writeDocuments.length > 0) {
    phases.push({ name: "write-documents", actions: writeDocuments });
  }
  if (uploadAttachments.length > 0) {
    phases.push({ name: "insert-attachments", actions: uploadAttachments });
  }

  return phases;
}

export function analyzeRemoteConflicts(proposal: SyncProposal, remote: RemoteManifest): string[] {
  const conflicts: string[] = [];
  const remoteDocxByTitle = new Map(
    remote.entries.filter((entry) => entry.type === "docx").map((entry) => [entry.name, entry])
  );
  const remoteByToken = new Map(remote.entries.map((entry) => [entry.token, entry]));

  for (const action of proposal.actions) {
    if (action.kind === "create-document" && remoteDocxByTitle.has(action.title)) {
      conflicts.push(`Remote docx already exists for new document title: ${action.title}`);
    }

    if (action.kind === "patch-document") {
      const current = remoteByToken.get(action.token);
      if (!current) {
        conflicts.push(`Remote document missing for patch ${action.path}: ${action.token}`);
      } else if (current.modifiedTime !== action.baseRemoteModifiedTime) {
        conflicts.push(
          `Remote document changed since proposal for ${action.path}: expected modifiedTime ${action.baseRemoteModifiedTime}, found ${current.modifiedTime ?? "missing"}`
        );
      }
    }
  }

  return conflicts;
}

export async function applyProposal(options: ApplyProposalOptions): Promise<ApplyResult> {
  const runner = options.run ?? runCommand;
  const scanRemoteFolder =
    options.scanRemoteFolder ?? ((folderToken: string): Promise<RemoteManifest> => defaultScanRemoteFolder(folderToken, runner));
  const loadState = options.loadState ?? defaultLoadState;
  const saveState = options.saveState ?? defaultSaveState;
  const now = options.now ?? (() => new Date());
  const proposalPath = resolve(options.proposalPath);
  const configPath = resolve(options.configPath);
  const journalPath = applyJournalPath(proposalPath);
  const proposal = await readJson<SyncProposal>(proposalPath);
  const journal: ApplyJournal = {
    proposalId: proposal.id,
    startedAt: now().toISOString(),
    status: "running",
    events: []
  };

  const record = async (
    step: string,
    event: Omit<ApplyJournalEvent, "at" | "step"> = {},
    status?: ApplyJournal["status"]
  ): Promise<void> => {
    journal.events.push({ at: now().toISOString(), step, ...event });
    if (status) {
      journal.status = status;
    }
    await writeJson(journalPath, journal);
  };

  if (proposal.blockers.length > 0) {
    await record("blocked", { problems: proposal.blockers }, "blocked");
    return { ok: false, status: "blocked", problems: proposal.blockers, journalPath };
  }

  const configDir = dirname(configPath);
  const config = parseConfig(await readUtf8(configPath));
  if (proposal.baseRemoteFolderToken !== config.remoteFolderToken) {
    const problem = `Proposal base remote folder token ${proposal.baseRemoteFolderToken} does not match config remote folder token ${config.remoteFolderToken}`;
    await record("folder-token-mismatch", { problems: [problem] }, "failed");
    return { ok: false, status: "failed", problems: [problem], journalPath };
  }
  const workspaceRoot = resolve(configDir, config.workspaceRoot);
  const statePath = resolve(workspaceRoot, config.statePath);
  const remote = await scanRemoteFolder(config.remoteFolderToken);
  const conflicts = analyzeRemoteConflicts(proposal, remote);
  if (conflicts.length > 0) {
    await record("conflict", { problems: conflicts }, "conflict");
    return { ok: false, status: "conflict", problems: conflicts, journalPath };
  }

  let state = await loadState(statePath, config.remoteFolderToken);
  let stateDirty = false;
  const remoteByToken = new Map(remote.entries.map((entry) => [entry.token, entry]));

  const persistState = async (): Promise<void> => {
    await saveState(statePath, state);
    stateDirty = false;
  };

  try {
    for (const phase of planApplySequence(proposal)) {
      if (phase.name === "create-placeholders") {
        for (const action of phase.actions.filter(isCreateDocumentAction)) {
          const created = await createPlaceholderDocument({
            action,
            config,
            workspaceRoot,
            run: runner
          });
          await record("create-placeholder", {
            action,
            createdToken: created.token,
            message: `Created placeholder for ${action.path}: ${created.token}`
          });
          state.documents[action.path] = {
            path: action.path,
            title: action.title,
            token: created.token,
            url: created.url ?? "",
            ...(created.modifiedTime ? { remoteModifiedTime: created.modifiedTime } : {}),
            localHash: ""
          };
          stateDirty = true;
          await persistState();
        }
        continue;
      }

      if (phase.name === "write-documents") {
        const referenceMap = buildReferenceMap(state);
        for (const action of phase.actions.filter(isDocumentWriteAction)) {
          const written = await writeDocument({
            action,
            config,
            workspaceRoot,
            state,
            remoteEntry: action.kind === "patch-document" ? remoteByToken.get(action.token) : undefined,
            referenceMap,
            run: runner
          });
          await record("write-document", {
            action,
            remoteToken: written.token,
            message: `Wrote document ${action.path}`
          });
          state.documents[action.path] = written;
          state.lastAppliedProposalId = proposal.id;
          stateDirty = true;
          await persistState();
        }
        continue;
      }

      for (const action of phase.actions.filter(isUploadAttachmentAction)) {
        const media = await insertAttachment({
          action,
          workspaceRoot,
          state,
          run: runner
        });
        await record("insert-attachment", {
          action,
          ...(media.token ? { remoteToken: media.token } : {}),
          message: `Inserted attachment ${action.path}`
        });
        if (media.token) {
          state.attachments[action.path] = {
            localPath: action.path,
            remoteToken: media.token,
            ...(media.url ? { remoteUrl: media.url } : {}),
            hash: action.hash
          };
          stateDirty = true;
          await persistState();
        }
      }
    }

    state.lastAppliedProposalId = proposal.id;
    stateDirty = true;
    await persistState();
    await record("applied", {}, "applied");
    return { ok: true, status: "applied", problems: [], journalPath };
  } catch (error) {
    const problems = [error instanceof Error ? error.message : String(error)];
    if (stateDirty) {
      try {
        await persistState();
      } catch (saveError) {
        const saveMessage = saveError instanceof Error ? saveError.message : String(saveError);
        if (!problems.includes(saveMessage)) {
          problems.push(saveMessage);
        }
      }
    }
    await record("failed", { problems }, "failed");
    return { ok: false, status: "failed", problems, journalPath };
  }
}

function applyJournalPath(proposalPath: string): string {
  const extension = extname(proposalPath);
  const stem = basename(proposalPath, extension);
  return join(dirname(proposalPath), `${stem}.apply-journal.json`);
}

async function createPlaceholderDocument(input: {
  action: Extract<ProposalAction, { kind: "create-document" }>;
  config: GitYourLarkConfig;
  workspaceRoot: string;
  run: ApplyRunner;
}): Promise<RemoteDocumentResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "gyl-placeholder-"));
  try {
    const placeholderPath = join(tempDir, "placeholder.md");
    await writeFile(placeholderPath, `# ${input.action.title}\n`, "utf8");
    const result = await input.run(
      "lark-cli",
      [
        "drive",
        "+import",
        "--as",
        "user",
        "--file",
        placeholderPath,
        "--type",
        "docx",
        "--folder-token",
        input.config.remoteFolderToken,
        "--name",
        input.action.title
      ],
      input.workspaceRoot
    );
    assertCommandSucceeded("create placeholder document", result);
    return parseDocumentResult(result.stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function writeDocument(input: {
  action: Extract<ProposalAction, { kind: "create-document" | "patch-document" }>;
  config: GitYourLarkConfig;
  workspaceRoot: string;
  state: GitYourLarkState;
  remoteEntry?: RemoteEntry;
  referenceMap: Record<string, ReferenceTarget>;
  run: ApplyRunner;
}): Promise<RemoteDocumentState> {
  const existing = input.state.documents[input.action.path];
  const token = input.action.kind === "patch-document" ? input.action.token : existing?.token;
  if (!token) {
    throw new Error(`No remote token available for ${input.action.path}`);
  }

  const markdown = await readUtf8(resolve(input.workspaceRoot, input.action.path));
  const rendered = renderMarkdownForLark({
    markdown,
    sourcePath: input.action.path,
    referenceMap: input.referenceMap,
    mode: input.config.referenceMode
  });
  if (rendered.unresolved.length > 0) {
    throw new Error(`Unresolved references while rendering ${input.action.path}: ${rendered.unresolved.join(", ")}`);
  }

  let updatedModifiedTime: string | undefined;
  if (input.action.kind === "create-document") {
    const result = await input.run(
      "lark-cli",
      [
        "docs",
        "+update",
        "--api-version",
        "v2",
        "--as",
        "user",
        "--doc",
        token,
        "--command",
        "overwrite",
        "--doc-format",
        "markdown",
        "--content",
        rendered.content
      ],
      input.workspaceRoot
    );
    assertCommandSucceeded(`write new document ${input.action.path}`, result);
    updatedModifiedTime = parseOptionalDocumentResult(result.stdout).modifiedTime;
  } else {
    const remoteMarkdown = await fetchRemoteMarkdown(token, input.run, input.workspaceRoot);
    const plan = planMarkdownWrite(remoteMarkdown, rendered.content);
    if (plan.kind === "str-replace") {
      const result = await input.run(
        "lark-cli",
        [
          "docs",
          "+update",
          "--api-version",
          "v2",
          "--as",
          "user",
          "--doc",
          token,
          "--command",
          "str_replace",
          "--doc-format",
          "markdown",
          "--pattern",
          plan.pattern,
          "--content",
          plan.replacement
        ],
        input.workspaceRoot
      );
      assertCommandSucceeded(`patch document ${input.action.path}`, result);
      updatedModifiedTime = parseOptionalDocumentResult(result.stdout).modifiedTime;
    } else if (plan.kind === "requires-overwrite") {
      if (input.config.overwritePolicy !== "allow") {
        throw new Error(`Overwrite required for ${input.action.path} but overwritePolicy is ${input.config.overwritePolicy}: ${plan.reason}`);
      }
      const result = await input.run(
        "lark-cli",
        [
          "docs",
          "+update",
          "--api-version",
          "v2",
          "--as",
          "user",
          "--doc",
          token,
          "--command",
          "overwrite",
          "--doc-format",
          "markdown",
          "--content",
          rendered.content
        ],
        input.workspaceRoot
      );
      assertCommandSucceeded(`overwrite document ${input.action.path}`, result);
      updatedModifiedTime = parseOptionalDocumentResult(result.stdout).modifiedTime;
    }
  }

  return {
    path: input.action.path,
    title: input.action.title,
    token,
    url: existing?.url ?? input.remoteEntry?.url ?? "",
    ...(updatedModifiedTime ?? input.remoteEntry?.modifiedTime ?? existing?.remoteModifiedTime
      ? { remoteModifiedTime: updatedModifiedTime ?? input.remoteEntry?.modifiedTime ?? existing?.remoteModifiedTime }
      : {}),
    localHash: input.action.hash
  };
}

async function fetchRemoteMarkdown(token: string, run: ApplyRunner, cwd: string): Promise<string> {
  const result = await run(
    "lark-cli",
    [
      "docs",
      "+fetch",
      "--api-version",
      "v2",
      "--as",
      "user",
      "--doc",
      token,
      "--doc-format",
      "markdown",
      "--format",
      "json"
    ],
    cwd
  );
  assertCommandSucceeded(`fetch remote markdown ${token}`, result);
  return parseFetchedMarkdown(result.stdout);
}

async function insertAttachment(input: {
  action: Extract<ProposalAction, { kind: "upload-attachment" }>;
  workspaceRoot: string;
  state: GitYourLarkState;
  run: ApplyRunner;
}): Promise<RemoteMediaResult> {
  const owner = input.state.documents[input.action.owner];
  if (!owner) {
    throw new Error(`Attachment owner is not available in state: ${input.action.owner}`);
  }
  const result = await input.run(
    "lark-cli",
    [
      "docs",
      "+media-insert",
      "--as",
      "user",
      "--doc",
      owner.token,
      "--file",
      resolve(input.workspaceRoot, input.action.path),
      "--type",
      mediaInsertType(input.action.path)
    ],
    input.workspaceRoot
  );
  assertCommandSucceeded(`insert attachment ${input.action.path}`, result);
  return parseOptionalMediaResult(result.stdout);
}

function buildReferenceMap(state: GitYourLarkState): Record<string, ReferenceTarget> {
  const referenceMap: Record<string, ReferenceTarget> = {};
  for (const document of Object.values(state.documents)) {
    if (!document.token) {
      continue;
    }
    const target = { token: document.token, url: document.url };
    for (const key of referenceKeys(document)) {
      referenceMap[key] = target;
    }
  }
  return referenceMap;
}

function referenceKeys(document: RemoteDocumentState): string[] {
  const keys = new Set<string>();
  keys.add(document.path);
  keys.add(stripMarkdownExtension(document.path));
  keys.add(document.title);
  keys.add(stripMarkdownExtension(document.path.split("/").at(-1) ?? document.path));
  return [...keys];
}

function stripMarkdownExtension(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

function parseDocumentResult(output: string): RemoteDocumentResult {
  const parsed = parseOptionalDocumentResult(output);
  if (!parsed.token) {
    throw new Error("lark-cli did not return a document token.");
  }
  return {
    token: parsed.token,
    ...(parsed.url ? { url: parsed.url } : {}),
    ...(parsed.modifiedTime ? { modifiedTime: parsed.modifiedTime } : {})
  };
}

function parseOptionalDocumentResult(output: string): RemoteDocumentResult {
  if (!output.trim()) {
    return { token: "" };
  }
  try {
    const root = extractJson(output) as Record<string, unknown>;
    const data = (root.data ?? root) as Record<string, unknown>;
    const nested = firstObject(data.file, data.doc, data.document, data.result) ?? data;
    return {
      token: stringField(nested, "token", "doc_token", "document_token", "obj_token") ?? "",
      url: stringField(nested, "url", "doc_url", "document_url"),
      modifiedTime: stringField(nested, "modified_time", "modifiedTime", "update_time")
    };
  } catch {
    return { token: "" };
  }
}

function parseOptionalMediaResult(output: string): RemoteMediaResult {
  if (!output.trim()) {
    return {};
  }
  try {
    const root = extractJson(output) as Record<string, unknown>;
    const data = (root.data ?? root) as Record<string, unknown>;
    const nested = firstObject(data.file, data.media, data.image, data.result) ?? data;
    return {
      token: stringField(nested, "token", "file_token", "media_token", "image_token"),
      url: stringField(nested, "url", "file_url", "media_url", "image_url")
    };
  } catch {
    return {};
  }
}

function parseFetchedMarkdown(output: string): string {
  try {
    const root = extractJson(output) as Record<string, unknown>;
    const data = (root.data ?? root) as Record<string, unknown>;
    const nested = firstObject(data.document, data.doc, data.result) ?? data;
    const content = stringField(nested, "markdown", "content", "text");
    return content ?? output;
  } catch {
    return output;
  }
}

function mediaInsertType(path: string): "image" | "file" {
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
  return imageExtensions.has(extname(path).toLowerCase()) ? "image" : "file";
}

function firstObject(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function stringField(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function assertCommandSucceeded(action: string, result: CommandResult): void {
  if (result.code !== 0) {
    throw new Error(`lark-cli failed to ${action}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function isCreateDocumentAction(action: ProposalAction): action is Extract<ProposalAction, { kind: "create-document" }> {
  return action.kind === "create-document";
}

function isDocumentWriteAction(action: ProposalAction): action is Extract<ProposalAction, { kind: "create-document" | "patch-document" }> {
  return action.kind === "create-document" || action.kind === "patch-document";
}

function isUploadAttachmentAction(action: ProposalAction): action is Extract<ProposalAction, { kind: "upload-attachment" }> {
  return action.kind === "upload-attachment";
}
