import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedConfig } from "./config.js";
import type { Task } from "./adapters/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load a template from the given path, or fall back to the default
 * template shipped with the package (`prompts/default.md`).
 */
export function loadTemplate(templatePath?: string): string {
  if (templatePath) {
    return fs.readFileSync(templatePath, "utf-8");
  }
  const defaultPath = path.resolve(__dirname, "..", "prompts", "default.md");
  return fs.readFileSync(defaultPath, "utf-8");
}

// ── Render ───────────────────────────────────────────────────────────

/**
 * Render the system prompt for a conductor agent session.
 *
 * Loads the markdown template (custom or default), substitutes all
 * `{{variable}}` placeholders, and conditionally includes/excludes
 * optional sections.
 */
export function renderPrompt(
  config: ResolvedConfig,
  task: Task,
  workspacePaths: Record<string, string>,
  options?: { repoHint?: string; extraContext?: string },
): string {
  const template = loadTemplate(config.agent.promptTemplate);

  // ── Build derived blocks ────────────────────────────────────────

  const reposOverview = Object.entries(config.repos)
    .map(([key, repo]) => {
      const wsPath = workspacePaths[key] ?? repo.path;
      return [
        `### ${repo.name}`,
        `- **Worktree path:** \`${wsPath}\``,
        `- **Platform:** ${repo.platform}`,
        `- **Base branch:** ${repo.baseBranch}`,
        repo.contextContent
          ? `- **Context:** repo conventions loaded (see Codebase Conventions below)`
          : `- **Context:** none provided`,
      ].join("\n");
    })
    .join("\n\n");

  const reposContext = Object.entries(config.repos)
    .filter(([, repo]) => repo.contextContent)
    .map(([, repo]) => `### ${repo.name}\n\n${repo.contextContent}`)
    .join("\n\n---\n\n");

  const commentsBlock =
    task.comments.length > 0
      ? task.comments.map((c) => `- ${c}`).join("\n")
      : "_No comments._";

  // ── Variable map ────────────────────────────────────────────────

  const vars: Record<string, string> = {
    "project.name": config.name,
    "task.id": task.id,
    "task.title": task.title,
    "task.description": task.description,
    "task.comments": commentsBlock,
    "task.url": task.url,
    repo_hint: options?.repoHint ?? "",
    extra_context: options?.extraContext ?? "",
    repos_overview: reposOverview,
    repos_context: reposContext || "_No repo-specific conventions loaded._",
  };

  // Also expose per-repo variables: {{repo.<key>.path}} and {{repo.<key>.context}}
  for (const [key, repo] of Object.entries(config.repos)) {
    vars[`repo.${key}.path`] = workspacePaths[key] ?? repo.path;
    vars[`repo.${key}.context`] = repo.contextContent ?? "";
  }

  // ── Substitute {{variable}} placeholders ────────────────────────

  let rendered = template.replace(/\{\{([^}]+)\}\}/g, (_match, varName: string) => {
    const trimmed = varName.trim();
    return vars[trimmed] ?? "";
  });

  // ── Conditional sections: {{#if var}} ... {{/if}} ───────────────

  rendered = rendered.replace(
    /\{\{#if\s+(\w+)\}\}\n?([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, content: string) => {
      const value = vars[varName.trim()] ?? "";
      return value.length > 0 ? content : "";
    },
  );

  // ── Strip sections whose heading content is empty ───────────────
  // If a ## section only contains whitespace after rendering, remove it.
  rendered = rendered.replace(
    /^(#{1,3} [^\n]+)\n{1,3}(?=#{1,3} |\n*$)/gm,
    "",
  );

  // Clean up excessive blank lines
  rendered = rendered.replace(/\n{3,}/g, "\n\n");

  return rendered.trim() + "\n";
}
