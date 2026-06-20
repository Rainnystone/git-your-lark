---
name: sync-workspace
description: Sync a local Markdown workspace to Lark/Feishu docx documents through lark-cli using reviewable previews and safe publish semantics.
---

# Git Your Lark: Sync Workspace

Use this skill when the user wants to publish or sync a local Markdown workspace to Lark/Feishu docx documents.

Git Your Lark is preview-first. Always create and explain a sync proposal before making document writes.

## Requirements

- Required dependency: the official `lark-cli` from `larksuite/cli`.
- Before any sync run, run `gyl doctor`.
- Use bare `gyl` in commands. The `gyl` CLI is provided by the plugin: on Claude Code it ships as `bin/gyl` on PATH; on Codex or a global npm install it comes from the `git-your-lark` package. If `gyl doctor` reports a missing `lark-cli`, stop and tell the user to install `@larksuite/cli`.
- Inspect doctor output. If auth or required scopes are missing or unclear, stop and show the reported or recommended auth command, or ask the user to authorize before continuing.

## Workflow

1. Identify the workspace root and whether a target Lark Drive folder token is already available.
2. Run `gyl doctor`.
3. If config is missing and the user has an existing folder token, run `gyl init --remote-folder-token <token>`.
4. If config is missing and this is the first publish, confirm the folder name with the user, then run `gyl init --create-remote-folder --folder-name "<name>"`.
5. If the user provides a parent folder token for first publish, add `--parent-folder-token <token>` to the create-folder init command.
6. Run `gyl proposal -c git-your-lark.yml`.
7. If proposal exits with code 2, it still wrote preview files with blockers. Read and explain those blockers, and do not publish.
8. Explain the preview in plain language, including changed documents, attachments, blockers, conflicts, and unresolved references.
9. Ask for explicit confirmation before any document writes.
10. Run `gyl publish <proposal-json-path> -c git-your-lark.yml` using the proposal JSON path printed by `gyl proposal -c git-your-lark.yml`, not the Markdown preview path. Do this only after confirmation and only if the proposal has no blockers.
11. Run `gyl verify -c git-your-lark.yml`.
12. Report changed docs, conflicts, unresolved refs, attachments, verification result, and any available Lark folder/doc URLs or tokens from config, state, proposal, or verify output.

## First Publish Behavior

If this is the first publish and no remote folder token exists, create a dedicated folder in the current user's Lark Drive. Confirm the folder name before creating it.

If a parent folder token is supplied, create the dedicated folder under that parent. Otherwise, create it under the current user's Drive root.

## Safety Rules

- Do not store Lark auth tokens outside `lark-cli` auth.
- Confirm the first remote folder name before creating it.
- Do not call Lark sharing or permission APIs in v1. Users share folders and documents from the Lark UI.
- Do not publish a proposal with blockers.
- The proposal does not explicitly mark overwrite requirement. With the default `overwritePolicy: explicit-only`, publish stops if overwrite is required. If the user accepts the overwrite risk, they must intentionally change the config, rerun preview, and publish the resulting proposal.
- If remote content changed since the preview, stop and report the conflict instead of guessing.
- Treat `apply` and `merge` as advanced aliases for this tool's publish flow, not as GitHub PR merge operations.

## User-Facing Language

Use clear status updates like:

- "I will create a sync preview first."
- "This is the first publish, so I will create a Lark Drive folder named NAME under your Drive root."
- "This preview changes N documents and uploads M attachments."
- "Remote changed since the preview, so I stopped instead of guessing."
- "I published the documents. Use the folder link below to share from Lark."
