# 交付纪律

所有非小修小改的改动一律走 PR,不直接 push 主分支。

## 分支

- 命名:`trae/agent-{随机ID}`(如 `trae/agent-dNyJy5`)
- 从主分支(master/main)切出,不基于其他功能分支

## Commit

- author:仓库所有者本人(如 `Rainnystone <Rainnystone@users.noreply.github.com>`),不是 traeagent
- 每个 commit 末尾加 trailer:`Co-authored-by: traeagent <traeagent@users.noreply.github.com>`
- message 用约定式提交:`feat:` / `fix:` / `refactor:` / `chore:` / `docs:`,后接简短描述

## PR

- 标题:约定式提交格式 + 中文描述(如 `refactor: 重构架构,引入适配器模块`)
- 描述结构化:
  - `## 🎯 Changes` —— 分模块(### 1. xxx)说明,每条带粗体小标题
  - `## 💡 Technical Highlights` —— 技术亮点与设计价值
  - 中文为主
- CI 全绿后再合并
- 合并后删除分支

## 禁止

- 不直接 push 主分支(小修小改如 typo、文档微调除外)
- 不把 commit author 设成 traeagent(traeagent 只作为 Co-authored-by)
- 不跳过 CI
