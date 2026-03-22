import fs from "fs/promises";
import path from "path";
import {
  appendStepSummary,
  buildAutofixBranchName,
  buildCommitMessage,
  collectFileContext,
  inferSuggestedFiles,
  listTrackedFiles,
  normalizeIssue,
  parseModelPlan,
  sanitizeText,
  setGitHubOutputs,
  type IssueEventPayload,
} from "./lib";

interface OpenAIChoice {
  message?: {
    content?: string;
  };
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function callModel(prompt: string): Promise<string> {
  const apiKey = requiredEnv("ISSUE_AUTOFIX_API_KEY");
  const model = process.env.ISSUE_AUTOFIX_MODEL ?? "gpt-4o-mini";
  const apiUrl = process.env.ISSUE_AUTOFIX_API_URL ?? "https://models.inference.ai.azure.com/chat/completions";

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "You generate safe, minimal repository patches.",
            "Return exactly one JSON object with keys summary, commitMessage, prTitle, prBody and patch.",
            "The patch must be a unified diff starting with diff --git and must not be wrapped in markdown fences.",
            "Do not invent files outside the repository manifest.",
            "Keep changes minimal and compatible with Bun and TypeScript.",
          ].join(" "),
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Model request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as OpenAIResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Model response did not include message content.");
  }

  return content;
}

async function main(): Promise<void> {
  const eventPath = requiredEnv("GITHUB_EVENT_PATH");
  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const patchOutputPath = process.env.PATCH_OUTPUT_PATH ?? path.join(repoRoot, "autofix.patch");
  const prBodyOutputPath = process.env.PR_BODY_OUTPUT_PATH ?? path.join(repoRoot, "autofix-pr.md");
  const event = JSON.parse(await fs.readFile(eventPath, "utf8")) as IssueEventPayload;

  const issue = normalizeIssue(event.issue);
  const repoFiles = await listTrackedFiles(repoRoot);
  const suggestedFiles = inferSuggestedFiles(issue, repoFiles);
  const contextFiles = await collectFileContext(repoRoot, suggestedFiles, 100_000);
  const branchName = buildAutofixBranchName(
    issue.number,
    issue.title,
    process.env.GITHUB_RUN_ID,
  );
  const defaultCommitMessage = buildCommitMessage(issue.number, issue.title);
  const prompt = JSON.stringify(
    {
      repository: event.repository?.full_name ?? "",
      defaultBranch: event.repository?.default_branch ?? "main",
      issue,
      suggestedFiles,
      repoFiles,
      instructions: {
        validationCommands: ["bun test", "bun run build"],
        branchName,
        commitMessage: defaultCommitMessage,
        allowedPatchTargets: ["src/**", "docs/**", "README.md"],
        guidance: [
          "Focus on the issue and edit only files that are necessary.",
          "Only edit files under src/, docs/ or README.md.",
          "If no safe fix is possible, return a patch that makes no changes and explain why in prBody.",
          "Prefer existing conventions already present in the repository.",
        ],
      },
      fileContext: contextFiles,
    },
    null,
    2,
  );

  const rawResponse = await callModel(prompt);
  const plan = parseModelPlan(rawResponse);
  const finalCommitMessage = plan.commitMessage || defaultCommitMessage;
  const finalPrTitle = plan.prTitle || `autofix: attempt issue #${issue.number}`;
  const finalPrBody = [
    "This draft PR was created automatically from a newly opened issue.",
    "",
    plan.prBody,
    "",
    `Closes #${issue.number}`,
  ]
    .filter(Boolean)
    .join("\n");

  await fs.writeFile(patchOutputPath, `${plan.patch}\n`, "utf8");
  await fs.writeFile(prBodyOutputPath, `${finalPrBody}\n`, "utf8");
  await appendStepSummary([
    "## Autofix Request",
    "",
    `- Issue: #${issue.number}`,
    `- Issue author: ${issue.author}`,
    `- Suggested files: ${suggestedFiles.join(", ") || "none"}`,
    `- Patch file: ${patchOutputPath}`,
  ].join("\n"));
  await setGitHubOutputs({
    patch_path: patchOutputPath,
    pr_body_path: prBodyOutputPath,
    branch_name: branchName,
    commit_message: finalCommitMessage,
    pr_title: finalPrTitle,
  });
}

await main();