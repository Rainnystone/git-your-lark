/**
 * Type declarations for the Claude plugin manifest validator.
 *
 * `scripts/claude-manifest.mjs` is a pure ESM module used by both
 * `scripts/validate-plugin.mjs` (plain Node) and the vitest suite. It is
 * intentionally not compiled by tsc; this ambient declaration gives TypeScript
 * consumers (the test file) a precise signature without `any`.
 */

export function validateClaudePlugin(rootDir: string): string[];
