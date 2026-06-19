---
name: sync-workspace
description: Preview and publish a local Markdown workspace to Lark/Feishu through lark-cli. This skill skeleton is part of the Git Your Lark v1 plugin and is still in development.
---

# Sync Workspace

Git Your Lark is a preview-first Codex plugin for publishing local Markdown workspaces to Lark/Feishu documents through `lark-cli`.

This skill implementation is in development. The intended v1 workflow is:

1. Check local workspace and `lark-cli` readiness.
2. Generate a reviewable sync preview before publishing.
3. Publish only after the preview is accepted and the remote base is still safe.
4. Verify the remote Lark documents after publishing.

V1 does not change Lark sharing permissions. After publishing, users share the resulting Lark folder or documents from the Lark UI.

Do not use MCP or app manifests for this v1 workflow.
