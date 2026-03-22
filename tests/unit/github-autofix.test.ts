import { describe, expect, it } from "bun:test";
import {
  assertAllowedPatchTargets,
  buildAutofixBranchName,
  extractUnifiedDiff,
  inferSuggestedFiles,
  normalizeIssue,
  parseModelPlan,
  sanitizeText,
} from "../../scripts/github-autofix/lib";

describe("GitHub autofix helpers", () => {
  it("[REQ-AUTO-003] sanitizes control characters and trims content", () => {
    const result = sanitizeText(" hello\u0000 world  \nnext\t\tline ");
    expect(result).toBe("hello world\nnext line");
  });

  it("[REQ-AUTO-003] builds safe branch names", () => {
    const branch = buildAutofixBranchName(42, "Fix ../weird && workflow name", "12345");
    expect(branch).toBe("autofix/issue-42-fix-weird-workflow-name-12345");
    expect(branch.includes("..")).toBe(false);
  });

  it("[REQ-AUTO-001] normalizes issues and suggests relevant files", () => {
    const issue = normalizeIssue({
      number: 9,
      title: "GitHub workflow should open PR for issue fixes",
      body: "Please update the workflow and tests.",
      labels: [{ name: "automation" }],
      user: { login: "octocat" },
    });

    const files = inferSuggestedFiles(issue, [
      ".github/workflows/issue-auto-fix.yml",
      "scripts/github-autofix/request-autofix.ts",
      "src/server.ts",
      "tests/unit/github-autofix.test.ts",
    ]);

    expect(files[0]).toBe(".github/workflows/issue-auto-fix.yml");
    expect(files).toContain("scripts/github-autofix/request-autofix.ts");
  });

  it("[REQ-AUTO-003] extracts unified diffs from fenced output", () => {
    const diff = extractUnifiedDiff("```diff\ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n```");
    expect(diff.startsWith("diff --git a/a.txt b/a.txt")).toBe(true);
  });

  it("[REQ-AUTO-003] rejects patches outside the trusted target allowlist", () => {
    expect(() =>
      assertAllowedPatchTargets(
        "diff --git a/.github/workflows/issue-auto-fix.yml b/.github/workflows/issue-auto-fix.yml\n--- a/.github/workflows/issue-auto-fix.yml\n+++ b/.github/workflows/issue-auto-fix.yml\n@@ -1 +1 @@\n-old\n+new",
      ),
    ).toThrow("Patch touches disallowed files");
  });

  it("[REQ-AUTO-003] accepts patches inside the trusted target allowlist", () => {
    const files = assertAllowedPatchTargets(
      "diff --git a/src/server.ts b/src/server.ts\n--- a/src/server.ts\n+++ b/src/server.ts\n@@ -1 +1 @@\n-old\n+new",
    );

    expect(files).toEqual(["src/server.ts"]);
  });

  it("[REQ-AUTO-002] parses model plans with unified diffs", () => {
    const plan = parseModelPlan(JSON.stringify({
      summary: "Fix workflow",
      commitMessage: "fix(issue-1): update workflow",
      prTitle: "autofix: update workflow",
      prBody: "Automated fix",
      patch: "diff --git a/src/server.ts b/src/server.ts\n--- a/src/server.ts\n+++ b/src/server.ts\n@@ -1 +1 @@\n-old\n+new",
    }));

    expect(plan.commitMessage).toContain("fix(issue-1)");
    expect(plan.patch).toContain("diff --git a/src/server.ts b/src/server.ts");
  });
});