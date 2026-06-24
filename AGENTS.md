# Delivery Discipline

All changes except trivial fixes (typos, doc tweaks) go through a PR. Never push directly to the main branch.

## Branches

- Naming: `trae/agent-{randomID}` (e.g. `trae/agent-dNyJy5`)
- Cut from the main branch (master/main), never from another feature branch

## Commits

- author: the repo owner (e.g. `Rainnystone <Rainnystone@users.noreply.github.com>`), never traeagent
- Append a trailer to every commit: `Co-authored-by: traeagent <traeagent@users.noreply.github.com>`
- Message uses Conventional Commits: `feat:` / `fix:` / `refactor:` / `chore:` / `docs:`, followed by a short description

## Pull Requests

- Title: Conventional Commits format + concise description (e.g. `refactor: introduce host adapter and shared transaction modules`)
- Structured description:
  - `## 🎯 Changes` — grouped by module (### 1. xxx), each entry with a bold sub-heading
  - `## 💡 Technical Highlights` — technical merits and design value
- Merge only after CI is fully green
- Delete the branch after merge

## Prohibited

- Never push directly to the main branch (trivial fixes like typos and doc tweaks are exempt)
- Never set the commit author to traeagent (traeagent appears only as Co-authored-by)
- Never skip CI
