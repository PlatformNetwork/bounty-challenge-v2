import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

interface RawAnalyzedIssue {
  number?: number;
  issue_number?: number;
  title?: string;
  issue_title?: string;
  body?: string;
  issue_body?: string;
  html_url?: string;
  issue_url?: string;
  labels?: string[];
  matched_files?: string[];
  affected_files?: string[];
  keywords?: string[];
  repo_context?: Record<string, unknown>;
}

interface NormalizedIssue {
  issue_number: number;
  issue_title: string;
  issue_body: string;
  issue_url: string;
  labels: string[];
  affected_files: string[];
  repo_context: Record<string, unknown>;
}

interface WorkerSpec {
  issue_number: number;
  issue_title: string;
  issue_body: string;
  issue_url: string;
  target_repo: string;
  branch_name: string;
  affected_files: string[];
  repo_context: Record<string, unknown>;
  instructions: string;
  pr_template: {
    title: string;
    body: string;
  };
}

interface DispatchManifestEntry {
  issue_number: number;
  issue_title: string;
  spec_file: string;
  branch_name: string;
  target_repo: string;
}

interface DispatchManifest {
  generated_at: string;
  total_specs: number;
  specs: DispatchManifestEntry[];
}

const TARGET_REPO = "CortexLM/cortex-ide";
const BOUNTY_REPO = "bounty-challenge";

function normalizeIssue(raw: RawAnalyzedIssue): NormalizedIssue {
  return {
    issue_number: raw.issue_number ?? raw.number ?? 0,
    issue_title: raw.issue_title ?? raw.title ?? "",
    issue_body: raw.issue_body ?? raw.body ?? "",
    issue_url: raw.issue_url ?? raw.html_url ?? "",
    labels: raw.labels ?? [],
    affected_files: raw.affected_files ?? raw.matched_files ?? [],
    repo_context: raw.repo_context ?? {},
  };
}

function buildBranchName(issueNumber: number): string {
  return `fix/bounty-issue-${issueNumber}`;
}

function buildInstructions(issue: NormalizedIssue): string {
  const fileList =
    issue.affected_files.length > 0
      ? issue.affected_files.map((f) => `  - ${f}`).join("\n")
      : "  (no specific files identified — investigate based on the issue description)";

  return [
    `You are a software engineer tasked with fixing a reported issue in the ${TARGET_REPO} repository.`,
    "",
    `## Issue #${issue.issue_number}: ${issue.issue_title}`,
    "",
    `Original issue URL: ${issue.issue_url}`,
    "",
    "## Issue Description",
    "",
    issue.issue_body,
    "",
    "## Affected Files",
    "",
    "The following files have been identified as relevant to this issue and should be examined:",
    "",
    fileList,
    "",
    "## Instructions",
    "",
    "1. Clone the target repository and create the branch `" +
      buildBranchName(issue.issue_number) +
      "`.",
    "2. Read and understand the affected files listed above.",
    "3. Identify the root cause of the issue described above.",
    "4. Implement a minimal, focused fix that resolves the issue without introducing regressions.",
    "5. Ensure the fix follows the existing code style and conventions of the repository.",
    "6. Run any existing tests to verify the fix does not break anything.",
    "7. If appropriate, add or update tests to cover the fix.",
    "8. Commit the changes with a clear, descriptive commit message referencing the issue.",
    "",
    "## Important Notes",
    "",
    "- Do NOT introduce unnecessary changes or refactors beyond what is needed to fix the issue.",
    "- Do NOT add new dependencies unless absolutely required.",
    "- Match the existing coding style exactly.",
    "- If the issue description is ambiguous, implement the most reasonable interpretation.",
  ].join("\n");
}

function buildPrTemplate(
  issue: NormalizedIssue
): WorkerSpec["pr_template"] {
  return {
    title: `Fix: ${issue.issue_title} (${BOUNTY_REPO}#${issue.issue_number})`,
    body: [
      `## Summary`,
      "",
      `Fixes the issue reported in ${issue.issue_url}`,
      "",
      `## Original Issue`,
      "",
      `**${issue.issue_title}** (${BOUNTY_REPO}#${issue.issue_number})`,
      "",
      issue.issue_body,
      "",
      `## Changes`,
      "",
      `<!-- Describe the changes made to fix the issue -->`,
      "",
      `## Testing`,
      "",
      `<!-- Describe how the fix was tested -->`,
      "",
      `---`,
      `*This PR was generated to address [${BOUNTY_REPO}#${issue.issue_number}](${issue.issue_url}).*`,
    ].join("\n"),
  };
}

function generateWorkerSpec(issue: NormalizedIssue): WorkerSpec {
  return {
    issue_number: issue.issue_number,
    issue_title: issue.issue_title,
    issue_body: issue.issue_body,
    issue_url: issue.issue_url,
    target_repo: TARGET_REPO,
    branch_name: buildBranchName(issue.issue_number),
    affected_files: issue.affected_files,
    repo_context: issue.repo_context,
    instructions: buildInstructions(issue),
    pr_template: buildPrTemplate(issue),
  };
}

function main(): void {
  const rootDir = process.cwd();
  const inputPath = join(rootDir, "output", "analyzed-issues.json");
  const outputDir = join(rootDir, "output", "worker-specs");
  const manifestPath = join(rootDir, "output", "dispatch-manifest.json");

  if (!existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    console.error(
      "Run the issue analyzer first to generate output/analyzed-issues.json"
    );
    process.exit(1);
  }

  const raw = readFileSync(inputPath, "utf-8");
  let rawIssues: RawAnalyzedIssue[];
  try {
    rawIssues = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Failed to parse ${inputPath}:`, err);
    process.exit(1);
  }

  if (!Array.isArray(rawIssues)) {
    console.error("Error: analyzed-issues.json must contain a JSON array");
    process.exit(1);
  }

  const issues = rawIssues.map(normalizeIssue);

  mkdirSync(outputDir, { recursive: true });

  const manifestEntries: DispatchManifestEntry[] = [];

  for (const issue of issues) {
    const spec = generateWorkerSpec(issue);
    const specFilename = `issue-${issue.issue_number}.json`;
    const specPath = join(outputDir, specFilename);

    writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n", "utf-8");
    console.log(`Generated: output/worker-specs/${specFilename}`);

    manifestEntries.push({
      issue_number: issue.issue_number,
      issue_title: issue.issue_title,
      spec_file: `output/worker-specs/${specFilename}`,
      branch_name: spec.branch_name,
      target_repo: spec.target_repo,
    });
  }

  const manifest: DispatchManifest = {
    generated_at: new Date().toISOString(),
    total_specs: manifestEntries.length,
    specs: manifestEntries,
  };

  writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8"
  );
  console.log(`\nGenerated: output/dispatch-manifest.json`);
  console.log(`Total worker specs: ${manifestEntries.length}`);
}

main();
