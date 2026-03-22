import fs from "fs/promises";
import path from "path";

export interface IssueLabel {
  name?: string;
}

export interface IssueRecord {
  number: number;
  title: string;
  body?: string | null;
  html_url?: string;
  user?: {
    login?: string;
  };
  labels?: IssueLabel[];
  created_at?: string;
  updated_at?: string;
}

export interface RepositoryRecord {
  full_name?: string;
  default_branch?: string;
}

export interface IssueCommentRecord {
  body?: string | null;
  author_association?: string;
  user?: {
    login?: string;
  };
}

export interface IssueEventPayload {
  action?: string;
  issue: IssueRecord;
  repository?: RepositoryRecord;
  comment?: IssueCommentRecord;
}

export interface NormalizedIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  summary: string;
  keywords: string[];
}

export interface ModelPlan {
  summary: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  patch: string;
}

const ALLOWED_PATCH_PREFIXES = ["src/", "docs/"];
const ALLOWED_PATCH_FILES = new Set(["README.md"]);

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE_RUN = /[ \t]{2,}/g;
const DEFAULT_FILE_HINTS: Record<string, string[]> = {
  workflow: [".github/workflows/issue-auto-fix.yml", ".github/workflows/issue-auto-analysis.yml", "scripts/github-autofix/request-autofix.ts"],
  github: [".github/workflows/issue-auto-fix.yml", ".github/workflows/issue-auto-analysis.yml", "scripts/github-autofix/lib.ts"],
  issue: ["scripts/github-autofix/analyze-issue.ts", "scripts/github-autofix/request-autofix.ts", ".github/workflows/issue-auto-analysis.yml"],
  pr: [".github/workflows/issue-auto-fix.yml", "scripts/github-autofix/request-autofix.ts", "README.md"],
  test: ["tests/unit/github-autofix.test.ts", "package.json", "build.ts"],
  build: ["build.ts", "package.json", "tsconfig.json"],
  docker: ["docker-compose.dev.yml", "Dockerfile.dev", "README.md"],
  voice: ["src/server.ts", "tests/unit/server.test.ts", "docs/CODEBASE_OVERVIEW.md"],
  command: ["src/server.ts", "tests/unit/server.test.ts"],
  audio: ["src/server.ts", "tests/unit/play-audio.test.ts", "tests/unit/play-audio-comparison.test.ts"],
};

export function sanitizeText(input: string | null | undefined, maxLength = 8_000): string {
  const base = (input ?? "").replace(/\r\n/g, "\n").replace(CONTROL_CHARS, "");
  const normalizedLines = base
    .split("\n")
    .map((line) => line.replace(WHITESPACE_RUN, " ").trim())
    .join("\n")
    .trim();

  return normalizedLines.slice(0, maxLength);
}

export function tokenizeIssueText(text: string): string[] {
  const tokens = sanitizeText(text, 16_000)
    .toLowerCase()
    .split(/[^a-z0-9._/-]+/)
    .filter((token) => token.length >= 3);

  return [...new Set(tokens)];
}

export function normalizeIssue(issue: IssueRecord): NormalizedIssue {
  const title = sanitizeText(issue.title, 256);
  const body = sanitizeText(issue.body, 8_000);
  const author = sanitizeText(issue.user?.login, 128) || "unknown";
  const labels = (issue.labels ?? [])
    .map((label) => sanitizeText(label.name, 128))
    .filter(Boolean);
  const combined = `${title}\n${body}\n${labels.join(" ")}`.trim();

  return {
    number: issue.number,
    title,
    body,
    url: sanitizeText(issue.html_url, 512),
    author,
    labels,
    createdAt: sanitizeText(issue.created_at, 128),
    updatedAt: sanitizeText(issue.updated_at, 128),
    summary: body ? `${title}\n\n${body}` : title,
    keywords: tokenizeIssueText(combined),
  };
}

export function sanitizeBranchSegment(value: string): string {
  const sanitized = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return sanitized || "issue";
}

export function buildAutofixBranchName(issueNumber: number, title: string, salt?: string): string {
  const segment = sanitizeBranchSegment(title);
  const suffix = sanitizeBranchSegment(salt ?? "");
  return suffix
    ? `autofix/issue-${issueNumber}-${segment}-${suffix}`
    : `autofix/issue-${issueNumber}-${segment}`;
}

export function buildCommitMessage(issueNumber: number, title: string): string {
  return `fix(issue-${issueNumber}): ${sanitizeText(title, 60) || "automated fix"}`;
}

export function inferSuggestedFiles(issue: NormalizedIssue, repoFiles: string[], limit = 12): string[] {
  const scores = new Map<string, number>();
  const combinedKeywords = new Set(issue.keywords);

  for (const [keyword, paths] of Object.entries(DEFAULT_FILE_HINTS)) {
    if (!combinedKeywords.has(keyword)) {
      continue;
    }

    for (const filePath of paths) {
      scores.set(filePath, (scores.get(filePath) ?? 0) + 10);
    }
  }

  for (const filePath of repoFiles) {
    let score = scores.get(filePath) ?? 0;
    const lowerPath = filePath.toLowerCase();

    for (const keyword of combinedKeywords) {
      if (lowerPath.includes(keyword)) {
        score += keyword.length > 5 ? 4 : 2;
      }
    }

    if (lowerPath.startsWith("src/")) {
      score += 1;
    }
    if (lowerPath.startsWith("tests/")) {
      score += 1;
    }

    if (score > 0) {
      scores.set(filePath, score);
    }
  }

  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([filePath]) => filePath)
    .filter((filePath) => repoFiles.includes(filePath))
    .slice(0, limit);
}

export async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ls-files failed: ${stderr.trim()}`);
  }

  const stdout = await new Response(proc.stdout).text();
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => !filePath.startsWith("dist/"));
}

export async function collectFileContext(
  repoRoot: string,
  filePaths: string[],
  maxBytes = 100_000,
): Promise<Array<{ path: string; content: string }>> {
  const contexts: Array<{ path: string; content: string }> = [];
  let consumedBytes = 0;

  for (const relativePath of filePaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    let content: string;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const normalized = sanitizeText(content, 20_000);
    const nextBytes = Buffer.byteLength(normalized, "utf8");
    if (consumedBytes + nextBytes > maxBytes) {
      break;
    }

    contexts.push({ path: relativePath, content: normalized });
    consumedBytes += nextBytes;
  }

  return contexts;
}

export function summarizeAnalysis(issue: NormalizedIssue, suggestedFiles: string[]): string {
  const labelText = issue.labels.length > 0 ? issue.labels.join(", ") : "none";
  const fileText = suggestedFiles.length > 0 ? suggestedFiles.join(", ") : "none";

  return [
    `Issue #${issue.number}: ${issue.title}`,
    `Author: ${issue.author}`,
    `Labels: ${labelText}`,
    `Suggested files: ${fileText}`,
  ].join("\n");
}

export function extractUnifiedDiff(text: string): string {
  const fencedMatch = text.match(/```diff\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const rawIndex = text.indexOf("diff --git ");
  if (rawIndex >= 0) {
    return text.slice(rawIndex).trim();
  }

  return sanitizeText(text, 120_000).trim();
}

export function extractPatchedFiles(patch: string): string[] {
  const matches = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)];

  return matches
    .map((match) => match[2]?.trim() || match[1]?.trim() || "")
    .filter(Boolean);
}

export function isAllowedPatchTarget(filePath: string): boolean {
  return ALLOWED_PATCH_FILES.has(filePath)
    || ALLOWED_PATCH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

export function assertAllowedPatchTargets(patch: string): string[] {
  const filePaths = extractPatchedFiles(patch);
  const disallowed = filePaths.filter((filePath) => !isAllowedPatchTarget(filePath));

  if (disallowed.length > 0) {
    throw new Error(`Patch touches disallowed files: ${disallowed.join(", ")}`);
  }

  return filePaths;
}

export function parseModelPlan(rawText: string): ModelPlan {
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new Error("Model response does not contain a JSON object.");
  }

  const parsed = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1)) as Partial<ModelPlan>;
  const patch = extractUnifiedDiff(parsed.patch ?? "");

  if (!patch.includes("diff --git ")) {
    throw new Error("Model response does not contain a unified diff.");
  }

  assertAllowedPatchTargets(patch);

  return {
    summary: sanitizeText(parsed.summary, 2_000),
    commitMessage: sanitizeText(parsed.commitMessage, 120),
    prTitle: sanitizeText(parsed.prTitle, 120),
    prBody: sanitizeText(parsed.prBody, 20_000),
    patch,
  };
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function appendStepSummary(markdown: string): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  await fs.appendFile(summaryPath, `${markdown}\n`, "utf8");
}

export async function setGitHubOutputs(values: Record<string, string>): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const serialized = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  await fs.appendFile(outputPath, `${serialized}\n`, "utf8");
}