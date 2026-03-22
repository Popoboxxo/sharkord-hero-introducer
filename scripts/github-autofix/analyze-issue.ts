import fs from "fs/promises";
import path from "path";
import {
  appendStepSummary,
  inferSuggestedFiles,
  listTrackedFiles,
  normalizeIssue,
  summarizeAnalysis,
  type IssueEventPayload,
  setGitHubOutputs,
  writeJsonFile,
} from "./lib";

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required.");
  }

  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const outputPath = process.env.ANALYSIS_OUTPUT_PATH ?? path.join(repoRoot, "issue-analysis.json");
  const event = JSON.parse(await fs.readFile(eventPath, "utf8")) as IssueEventPayload;
  const issue = normalizeIssue(event.issue);
  const repoFiles = await listTrackedFiles(repoRoot);
  const suggestedFiles = inferSuggestedFiles(issue, repoFiles);
  const summary = summarizeAnalysis(issue, suggestedFiles);

  const analysis = {
    issue,
    repository: {
      fullName: event.repository?.full_name ?? "",
      defaultBranch: event.repository?.default_branch ?? "main",
    },
    suggestedFiles,
    summary,
    automationFeasible: true,
    generatedAt: new Date().toISOString(),
  };

  await writeJsonFile(outputPath, analysis);
  await appendStepSummary([
    "## Issue Analysis",
    "",
    `- Issue: #${issue.number}`,
    `- Title: ${issue.title}`,
    `- Suggested files: ${suggestedFiles.join(", ") || "none"}`,
  ].join("\n"));
  await setGitHubOutputs({ analysis_path: outputPath, issue_number: String(issue.number) });
}

await main();