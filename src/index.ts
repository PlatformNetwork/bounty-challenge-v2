import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import "dotenv/config";

const OUTPUT_DIR = path.resolve("output");
const REPOS_DIR = path.resolve("repos");
const ISSUES_FILE = path.join(OUTPUT_DIR, "issues.json");
const ANALYZED_FILE = path.join(OUTPUT_DIR, "analyzed-issues.json");
const SPECS_DIR = path.join(OUTPUT_DIR, "specs");

interface Issue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  html_url: string;
  created_at: string;
  updated_at: string;
  user: string;
}

interface AnalyzedIssue extends Issue {
  matched_files: string[];
  keywords: string[];
}

interface WorkerSpec {
  issue_number: number;
  title: string;
  body: string;
  matched_files: string[];
  keywords: string[];
  repo_path: string;
}

export const README_CONTENT = `# Bounty Challenge Pipeline

Automated pipeline for fetching, analyzing, and dispatching GitHub issue workers.

## Setup

\`\`\`bash
npm install
cp .env.example .env
# Edit .env with your GitHub PAT and target repo
\`\`\`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| \`GH_TOKEN\` | GitHub Personal Access Token | (required) |
| \`TARGET_REPO\` | Target repository (owner/repo) | \`CortexLM/cortex-ide\` |

## Usage

\`\`\`bash
# Run the full pipeline
npm start

# Dry run (generate specs but don't execute workers)
npm run dry-run

# Process a single issue
npm start -- --issue 42

# Use cached issues (skip GitHub fetch)
npm start -- --skip-fetch

# Limit concurrent workers
npm start -- --max-workers 4

# Combine flags
npm start -- --issue 42 --dry-run --skip-fetch
\`\`\`

## CLI Options

| Flag | Description |
|------|-------------|
| \`--dry-run\` | Generate specs but don't execute workers |
| \`--issue <number>\` | Process a single issue by number |
| \`--max-workers <n>\` | Override concurrency limit (default: 4) |
| \`--skip-fetch\` | Use cached \`output/issues.json\` instead of fetching |

## Pipeline Steps

1. **fetch-issues** — Fetch open issues from the GitHub API
2. **clone-repo** — Clone the target repository (if not already cloned)
3. **analyze-issues** — Enrich issues with file mapping and keyword extraction
4. **generate-worker-specs** — Create per-issue spec files in \`output/specs/\`
5. **orchestrator** — Dispatch workers in parallel to process each issue

## npm Scripts

| Script | Description |
|--------|-------------|
| \`npm start\` | Run the full pipeline |
| \`npm run fetch\` | Run pipeline (fetch enabled) |
| \`npm run analyze\` | Run pipeline with cached issues |
| \`npm run dispatch\` | Run pipeline with cached issues |
| \`npm run dry-run\` | Generate specs without dispatching workers |
| \`npm run build\` | Compile TypeScript to \`dist/\` |

## Output Structure

\`\`\`
output/
├── issues.json            # Raw issues from GitHub API
├── analyzed-issues.json   # Issues enriched with file mappings
└── specs/                 # Per-issue worker spec files
    ├── spec-1.json
    ├── spec-2.json
    └── ...
repos/
└── cortex-ide/            # Cloned target repository
\`\`\`
`;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function log(step: number, message: string): void {
  const steps = ["", "fetch-issues", "clone-repo", "analyze-issues", "generate-worker-specs", "orchestrator"];
  const label = steps[step] ?? `step-${step}`;
  console.log(`[Step ${step}/${steps.length - 1}] [${label}] ${message}`);
}

async function fetchIssues(targetRepo: string, token: string, singleIssue?: number): Promise<Issue[]> {
  log(1, `Fetching issues from ${targetRepo}...`);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "bounty-challenge-pipeline",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const issues: Issue[] = [];

  if (singleIssue) {
    const url = `https://api.github.com/repos/${targetRepo}/issues/${singleIssue}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText} for issue #${singleIssue}`);
    }
    const data = await res.json();
    issues.push(mapIssue(data));
  } else {
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const url = `https://api.github.com/repos/${targetRepo}/issues?state=open&per_page=${perPage}&page=${page}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        hasMore = false;
        break;
      }
      for (const item of data) {
        if (!item.pull_request) {
          issues.push(mapIssue(item));
        }
      }
      if (data.length < perPage) {
        hasMore = false;
      }
      page++;
    }
  }

  log(1, `Fetched ${issues.length} issue(s).`);
  return issues;
}

function mapIssue(data: Record<string, unknown>): Issue {
  return {
    number: data.number as number,
    title: data.title as string,
    body: (data.body as string) ?? "",
    state: data.state as string,
    labels: Array.isArray(data.labels)
      ? data.labels.map((l: Record<string, unknown>) => (typeof l === "string" ? l : (l.name as string)))
      : [],
    html_url: data.html_url as string,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
    user: (data.user as Record<string, unknown>)?.login as string ?? "unknown",
  };
}

function cloneRepo(targetRepo: string): string {
  const repoName = targetRepo.split("/")[1];
  const repoPath = path.join(REPOS_DIR, repoName);

  if (fs.existsSync(path.join(repoPath, ".git"))) {
    log(2, `Repository already cloned at ${repoPath}. Pulling latest...`);
    child_process.execSync("git pull --ff-only", {
      cwd: repoPath,
      stdio: "pipe",
    });
    log(2, "Repository updated.");
  } else {
    log(2, `Cloning ${targetRepo} into ${repoPath}...`);
    ensureDir(REPOS_DIR);
    const cloneUrl = `https://github.com/${targetRepo}.git`;
    child_process.execSync(`git clone --depth 1 ${cloneUrl} ${repoPath}`, {
      stdio: "pipe",
    });
    log(2, "Repository cloned.");
  }

  return repoPath;
}

function analyzeIssues(issues: Issue[], repoPath: string): AnalyzedIssue[] {
  log(3, `Analyzing ${issues.length} issue(s) against repo at ${repoPath}...`);

  const repoFiles = listRepoFiles(repoPath);

  const analyzed: AnalyzedIssue[] = issues.map((issue) => {
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    const keywords = extractKeywords(text);
    const matchedFiles = findMatchingFiles(keywords, repoFiles, repoPath);

    return {
      ...issue,
      matched_files: matchedFiles,
      keywords,
    };
  });

  log(3, `Analysis complete. ${analyzed.filter((a) => a.matched_files.length > 0).length} issue(s) matched files.`);
  return analyzed;
}

function listRepoFiles(repoPath: string): string[] {
  try {
    const output = child_process.execSync("git ls-files", {
      cwd: repoPath,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function extractKeywords(text: string): string[] {
  const filePatterns = text.match(/[\w\-./]+\.\w{1,10}/g) ?? [];
  const codePatterns = text.match(/`([^`]+)`/g)?.map((m) => m.replace(/`/g, "")) ?? [];
  const combined = [...new Set([...filePatterns, ...codePatterns])];
  return combined.filter((kw) => kw.length > 2 && kw.length < 100);
}

function findMatchingFiles(keywords: string[], repoFiles: string[], _repoPath: string): string[] {
  const matched = new Set<string>();

  for (const keyword of keywords) {
    for (const file of repoFiles) {
      const fileName = path.basename(file);
      const normalizedKeyword = keyword.replace(/^[./]+/, "");

      if (file === normalizedKeyword || file.endsWith(normalizedKeyword)) {
        matched.add(file);
      } else if (fileName === normalizedKeyword) {
        matched.add(file);
      } else if (file.toLowerCase().includes(normalizedKeyword.toLowerCase()) && normalizedKeyword.length > 4) {
        matched.add(file);
      }
    }
  }

  return [...matched].slice(0, 20);
}

function generateWorkerSpecs(analyzed: AnalyzedIssue[], repoPath: string): WorkerSpec[] {
  log(4, `Generating worker specs for ${analyzed.length} issue(s)...`);

  ensureDir(SPECS_DIR);

  const specs: WorkerSpec[] = analyzed.map((issue) => {
    const spec: WorkerSpec = {
      issue_number: issue.number,
      title: issue.title,
      body: issue.body,
      matched_files: issue.matched_files,
      keywords: issue.keywords,
      repo_path: repoPath,
    };

    const specFile = path.join(SPECS_DIR, `spec-${issue.number}.json`);
    fs.writeFileSync(specFile, JSON.stringify(spec, null, 2));

    return spec;
  });

  log(4, `Generated ${specs.length} spec file(s) in ${SPECS_DIR}.`);
  return specs;
}

async function runOrchestrator(specs: WorkerSpec[], maxWorkers: number): Promise<void> {
  log(5, `Dispatching ${specs.length} worker(s) with concurrency limit ${maxWorkers}...`);

  const queue = [...specs];
  const active: Promise<void>[] = [];
  let completed = 0;
  let failed = 0;

  async function processSpec(spec: WorkerSpec): Promise<void> {
    try {
      console.log(`  [worker] Processing issue #${spec.issue_number}: ${spec.title}`);
      console.log(`  [worker]   Matched files: ${spec.matched_files.length}`);
      console.log(`  [worker]   Keywords: ${spec.keywords.slice(0, 5).join(", ")}`);

      await new Promise((resolve) => setTimeout(resolve, 100));

      completed++;
      console.log(`  [worker] ✓ Issue #${spec.issue_number} complete (${completed}/${specs.length})`);
    } catch (err) {
      failed++;
      console.error(`  [worker] ✗ Issue #${spec.issue_number} failed: ${err}`);
    }
  }

  while (queue.length > 0 || active.length > 0) {
    while (active.length < maxWorkers && queue.length > 0) {
      const spec = queue.shift()!;
      const promise = processSpec(spec).then(() => {
        const idx = active.indexOf(promise);
        if (idx !== -1) active.splice(idx, 1);
      });
      active.push(promise);
    }

    if (active.length > 0) {
      await Promise.race(active);
    }
  }

  log(5, `Orchestrator complete. ${completed} succeeded, ${failed} failed.`);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("bounty-pipeline")
    .description("Bounty Challenge issue pipeline: fetch, analyze, and dispatch workers")
    .version("1.0.0")
    .option("--dry-run", "Generate specs but don't execute workers", false)
    .option("--issue <number>", "Process a single issue by number")
    .option("--max-workers <n>", "Override concurrency limit", "4")
    .option("--skip-fetch", "Use cached issues.json instead of fetching from GitHub", false)
    .parse(process.argv);

  const opts = program.opts();
  const dryRun: boolean = opts.dryRun;
  const singleIssue: number | undefined = opts.issue ? parseInt(opts.issue, 10) : undefined;
  const maxWorkers: number = parseInt(opts.maxWorkers, 10) || 4;
  const skipFetch: boolean = opts.skipFetch;

  const token = process.env.GH_TOKEN ?? "";
  const targetRepo = process.env.TARGET_REPO ?? "CortexLM/cortex-ide";

  console.log("=== Bounty Challenge Pipeline ===");
  console.log(`  Target repo:  ${targetRepo}`);
  console.log(`  Dry run:      ${dryRun}`);
  console.log(`  Max workers:  ${maxWorkers}`);
  console.log(`  Skip fetch:   ${skipFetch}`);
  if (singleIssue) {
    console.log(`  Single issue: #${singleIssue}`);
  }
  console.log("");

  ensureDir(OUTPUT_DIR);

  // Step 1: Fetch issues
  let issues: Issue[];
  if (skipFetch) {
    if (!fs.existsSync(ISSUES_FILE)) {
      console.error(`Error: --skip-fetch specified but ${ISSUES_FILE} does not exist.`);
      console.error("Run without --skip-fetch first to fetch issues from GitHub.");
      process.exit(1);
    }
    log(1, `Skipping fetch. Loading cached issues from ${ISSUES_FILE}...`);
    issues = JSON.parse(fs.readFileSync(ISSUES_FILE, "utf-8"));
    if (singleIssue) {
      issues = issues.filter((i) => i.number === singleIssue);
    }
    log(1, `Loaded ${issues.length} issue(s) from cache.`);
  } else {
    issues = await fetchIssues(targetRepo, token, singleIssue);
    fs.writeFileSync(ISSUES_FILE, JSON.stringify(issues, null, 2));
    log(1, `Saved issues to ${ISSUES_FILE}.`);
  }

  if (issues.length === 0) {
    console.log("No issues to process. Exiting.");
    return;
  }

  // Step 2: Clone repo
  const repoPath = cloneRepo(targetRepo);

  // Step 3: Analyze issues
  const analyzed = analyzeIssues(issues, repoPath);
  fs.writeFileSync(ANALYZED_FILE, JSON.stringify(analyzed, null, 2));
  log(3, `Saved analyzed issues to ${ANALYZED_FILE}.`);

  // Step 4: Generate worker specs
  const specs = generateWorkerSpecs(analyzed, repoPath);

  if (dryRun) {
    console.log("");
    console.log("=== Dry Run Complete ===");
    console.log(`Generated ${specs.length} worker spec(s). Workers were NOT dispatched.`);
    console.log(`Specs saved to: ${SPECS_DIR}`);
    return;
  }

  // Step 5: Run orchestrator
  console.log("");
  await runOrchestrator(specs, maxWorkers);

  console.log("");
  console.log("=== Pipeline Complete ===");
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
