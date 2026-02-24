import * as fs from "node:fs";
import * as path from "node:path";
import {
  createBranch,
  commitChanges,
  pushBranch,
  createPR,
} from "./git-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface FileSuggestion {
  file: string;
  line: number | null;
  original: string;
  replacement: string;
  description: string;
}

interface PatchEntry {
  file: string;
  suggestions: FileSuggestion[];
}

type WorkerStatus = "success" | "failure" | "needs-manual-review";

interface WorkerResult {
  status: WorkerStatus;
  issue_number: number;
  branch: string;
  patch_file: string;
  pr_url: string | null;
  message: string;
  applied_fixes: string[];
}

interface IncomingMessage {
  type: "spec";
  payload: {
    id: string;
    issueNumber: number;
    repo: string;
    branch: string;
    title: string;
    specFile: string;
  };
}

interface OutgoingMessage {
  type: "result";
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------

const WORKSPACE_DIR = path.resolve(process.cwd(), "workspace", "cortex-ide");

function loadSpecFromFile(specPath: string): WorkerSpec {
  const resolved = path.resolve(specPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Worker spec file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf-8");
  const spec = JSON.parse(raw) as WorkerSpec;

  if (!spec.issue_number || !spec.target_repo || !spec.branch_name) {
    throw new Error(
      "Worker spec missing required fields: issue_number, target_repo, branch_name"
    );
  }

  spec.affected_files = spec.affected_files || [];
  spec.issue_body = spec.issue_body || "";
  spec.issue_title = spec.issue_title || `Issue #${spec.issue_number}`;
  spec.repo_context = spec.repo_context || {};
  spec.instructions = spec.instructions || "";
  spec.pr_template = spec.pr_template || { title: "", body: "" };

  return spec;
}

// ---------------------------------------------------------------------------
// File reading from cortex-ide workspace
// ---------------------------------------------------------------------------

function readAffectedFiles(spec: WorkerSpec): Map<string, string> {
  const contents = new Map<string, string>();

  for (const filePath of spec.affected_files) {
    const fullPath = path.resolve(WORKSPACE_DIR, filePath);
    if (fs.existsSync(fullPath)) {
      try {
        contents.set(filePath, fs.readFileSync(fullPath, "utf-8"));
      } catch {
        contents.set(filePath, "");
      }
    }
  }

  return contents;
}

// ---------------------------------------------------------------------------
// Issue body analysis helpers
// ---------------------------------------------------------------------------

function extractCodeBlocks(body: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    blocks.push({ lang: match[1] || "", code: match[2].trim() });
  }
  return blocks;
}

function extractFileReferences(body: string): string[] {
  const refs: string[] = [];
  const patterns = [
    /(?:in|at|file|see|from)\s+[`"]?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,10})[`"]?/gi,
    /`([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,10})`/g,
    /([a-zA-Z0-9_\-/]+\.(rs|ts|tsx|js|jsx|py|toml|yml|yaml|json|md|cfg|conf|txt|css|scss|html))/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const ref = match[1];
      if (
        ref &&
        !refs.includes(ref) &&
        !ref.startsWith("http") &&
        ref.length < 200
      ) {
        refs.push(ref);
      }
    }
  }

  return refs;
}

function extractLineReferences(body: string): Map<string, number[]> {
  const lineRefs = new Map<string, number[]>();

  const fileLinePattern =
    /([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,10})[:#](?:L)?(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = fileLinePattern.exec(body)) !== null) {
    const file = match[1];
    const line = parseInt(match[2], 10);
    if (!lineRefs.has(file)) lineRefs.set(file, []);
    lineRefs.get(file)!.push(line);
  }

  const lineInPattern =
    /[Ll]ine\s+(\d+)\s+(?:in|of)\s+[`"]?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,10})[`"]?/g;
  while ((match = lineInPattern.exec(body)) !== null) {
    const line = parseInt(match[1], 10);
    const file = match[2];
    if (!lineRefs.has(file)) lineRefs.set(file, []);
    lineRefs.get(file)!.push(line);
  }

  return lineRefs;
}

function detectReplacements(body: string): { from: string; to: string }[] {
  const replacements: { from: string; to: string }[] = [];
  const codeBlocks = extractCodeBlocks(body);

  for (let i = 0; i < codeBlocks.length - 1; i++) {
    const current = codeBlocks[i];
    const next = codeBlocks[i + 1];
    const currentEnd =
      body.indexOf("```", body.indexOf(current.code)) +
      current.code.length +
      3;
    const nextStart = body.indexOf("```" + next.lang, currentEnd);
    if (nextStart < 0) continue;

    const between = body.substring(currentEnd, nextStart);

    if (
      /should\s+be|replace\s+with|change\s+to|fix(?:ed)?\s*:/i.test(between)
    ) {
      replacements.push({ from: current.code, to: next.code });
    }
  }

  const inlinePattern =
    /[`"]([^`"]+)[`"]\s*(?:should\s+be|→|->|=>|replace\s+with|change\s+to)\s*[`"]([^`"]+)[`"]/gi;
  let match: RegExpExecArray | null;
  while ((match = inlinePattern.exec(body)) !== null) {
    replacements.push({ from: match[1], to: match[2] });
  }

  return replacements;
}

// ---------------------------------------------------------------------------
// Issue analysis — produces patch entries
// ---------------------------------------------------------------------------

function analyzeIssue(
  spec: WorkerSpec,
  fileContents: Map<string, string>
): PatchEntry[] {
  const patches: PatchEntry[] = [];
  const fileRefs = extractFileReferences(spec.issue_body);
  const lineRefs = extractLineReferences(spec.issue_body);
  const replacements = detectReplacements(spec.issue_body);
  const codeBlocks = extractCodeBlocks(spec.issue_body);

  const allFiles = new Set([...spec.affected_files, ...fileRefs]);

  for (const file of allFiles) {
    const suggestions: FileSuggestion[] = [];
    const content = fileContents.get(file) || "";
    const lines = lineRefs.get(file) || [];

    for (const replacement of replacements) {
      if (content && content.includes(replacement.from)) {
        const lineIdx = content
          .substring(0, content.indexOf(replacement.from))
          .split("\n").length;
        suggestions.push({
          file,
          line: lineIdx,
          original: replacement.from,
          replacement: replacement.to,
          description: "Replace identified text from issue analysis",
        });
      }
    }

    if (suggestions.length === 0 && lines.length > 0) {
      const contentLines = content.split("\n");
      for (const lineNum of lines) {
        if (lineNum > 0 && lineNum <= contentLines.length) {
          suggestions.push({
            file,
            line: lineNum,
            original: contentLines[lineNum - 1],
            replacement: "",
            description:
              "Line referenced in issue — requires manual review",
          });
        }
      }
    }

    if (suggestions.length === 0 && codeBlocks.length > 0) {
      for (const block of codeBlocks) {
        if (content && content.includes(block.code)) {
          suggestions.push({
            file,
            line: null,
            original: block.code,
            replacement: "",
            description:
              "Code block from issue found in file — review for potential fix",
          });
        }
      }
    }

    if (
      suggestions.length === 0 &&
      (spec.affected_files.includes(file) || fileRefs.includes(file))
    ) {
      suggestions.push({
        file,
        line: null,
        original: "",
        replacement: "",
        description: "File referenced in issue — requires manual inspection",
      });
    }

    if (suggestions.length > 0) {
      patches.push({ file, suggestions });
    }
  }

  return patches;
}

// ---------------------------------------------------------------------------
// Patch file generation
// ---------------------------------------------------------------------------

function generatePatchFile(
  issueNumber: number,
  spec: WorkerSpec,
  patches: PatchEntry[]
): string {
  const patchDir = path.resolve("output", "patches");
  fs.mkdirSync(patchDir, { recursive: true });

  const patchPath = path.join(patchDir, `issue-${issueNumber}.patch`);

  let content = "";
  content += `# Patch for Issue #${issueNumber}\n`;
  content += `# Title: ${spec.issue_title}\n`;
  content += `# Repository: ${spec.target_repo}\n`;
  content += `# Generated by bounty-challenge worker\n`;
  content += `#\n`;
  content += `# Issue Body Summary:\n`;

  const bodyLines = spec.issue_body.split("\n").slice(0, 10);
  for (const line of bodyLines) {
    content += `#   ${line}\n`;
  }
  if (spec.issue_body.split("\n").length > 10) {
    content += `#   ... (truncated)\n`;
  }
  content += `#\n\n`;

  for (const entry of patches) {
    content += `--- a/${entry.file}\n`;
    content += `+++ b/${entry.file}\n`;

    for (const suggestion of entry.suggestions) {
      if (suggestion.line !== null) {
        content += `@@ -${suggestion.line},1 +${suggestion.line},1 @@\n`;
      } else {
        content += `@@ file-level suggestion @@\n`;
      }
      content += `# ${suggestion.description}\n`;
      if (suggestion.original) {
        for (const origLine of suggestion.original.split("\n")) {
          content += `-${origLine}\n`;
        }
      }
      if (suggestion.replacement) {
        for (const repLine of suggestion.replacement.split("\n")) {
          content += `+${repLine}\n`;
        }
      }
      content += `\n`;
    }
  }

  if (patches.length === 0) {
    content += `# No specific file-level suggestions could be derived from the issue.\n`;
    content += `# Manual review of the issue description is required.\n`;
  }

  fs.writeFileSync(patchPath, content, "utf-8");
  return patchPath;
}

// ---------------------------------------------------------------------------
// Automated fix application
// ---------------------------------------------------------------------------

function applyAutomatedFixes(
  patches: PatchEntry[],
  fileContents: Map<string, string>
): string[] {
  const applied: string[] = [];

  for (const entry of patches) {
    for (const suggestion of entry.suggestions) {
      if (!suggestion.original || !suggestion.replacement) {
        continue;
      }

      const content = fileContents.get(entry.file);
      if (!content || !content.includes(suggestion.original)) continue;

      const isSimpleReplacement =
        suggestion.original.split("\n").length <= 5 &&
        suggestion.replacement.split("\n").length <= 5;

      if (!isSimpleReplacement) continue;

      const updated = content.replace(
        suggestion.original,
        suggestion.replacement
      );
      const fullPath = path.resolve(WORKSPACE_DIR, entry.file);

      try {
        fs.writeFileSync(fullPath, updated, "utf-8");
        fileContents.set(entry.file, updated);
        applied.push(
          `${entry.file}: replaced "${truncate(suggestion.original, 60)}" with "${truncate(suggestion.replacement, 60)}"`
        );
      } catch {
        // skip files we can't write to
      }
    }
  }

  return applied;
}

function truncate(str: string, maxLen: number): string {
  const oneLine = str.replace(/\n/g, " ");
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.substring(0, maxLen) + "...";
}

// ---------------------------------------------------------------------------
// PR body builder
// ---------------------------------------------------------------------------

function buildPrBody(
  spec: WorkerSpec,
  patches: PatchEntry[],
  appliedFixes: string[]
): string {
  let body = `## Fix for Issue #${spec.issue_number}\n\n`;
  body += `**Issue:** [${spec.issue_title}](${spec.issue_url})\n\n`;

  if (appliedFixes.length > 0) {
    body += `### Automated Fixes Applied\n\n`;
    for (const fix of appliedFixes) {
      body += `- ${fix}\n`;
    }
    body += `\n`;
  }

  if (patches.length > 0) {
    body += `### Files Analyzed\n\n`;
    for (const entry of patches) {
      body += `- \`${entry.file}\` — ${entry.suggestions.length} suggestion(s)\n`;
      for (const s of entry.suggestions) {
        const lineInfo = s.line !== null ? ` (line ${s.line})` : "";
        body += `  - ${s.description}${lineInfo}\n`;
      }
    }
    body += `\n`;
  }

  body += `### Patch File\n\n`;
  body += `A detailed patch file has been generated at \`output/patches/issue-${spec.issue_number}.patch\`\n\n`;

  if (appliedFixes.length === 0) {
    body += `> **Note:** No automated fixes could be applied. This PR contains the patch analysis for manual review.\n\n`;
  }

  body += `---\n`;
  body += `*Generated by bounty-challenge worker*\n`;

  return body;
}

// ---------------------------------------------------------------------------
// Core fix workflow
// ---------------------------------------------------------------------------

async function executeFixWorkflow(spec: WorkerSpec): Promise<WorkerResult> {
  const branchName = spec.branch_name;
  let patchFile = "";
  let prUrl: string | null = null;
  const appliedFixes: string[] = [];

  // Step 1: Create dedicated branch via git-manager
  createBranch(branchName);

  // Step 2: Read affected files from cortex-ide workspace
  const fileContents = readAffectedFiles(spec);

  // Step 3: Analyze the issue body against affected files
  const patches = analyzeIssue(spec, fileContents);

  // Step 4: Generate the patch file at output/patches/issue-<number>.patch
  patchFile = generatePatchFile(spec.issue_number, spec, patches);

  // Step 5: Apply automated fixes for simple replacements
  const fixes = applyAutomatedFixes(patches, fileContents);
  appliedFixes.push(...fixes);

  // Step 6: Commit and push via git-manager
  const hasAutoFixes = appliedFixes.length > 0;

  if (hasAutoFixes) {
    const commitMessage = `fix: auto-fix for issue #${spec.issue_number} — ${spec.issue_title}`;

    const changedFiles = patches
      .flatMap((p) =>
        p.suggestions
          .filter((s) => s.original && s.replacement)
          .map(() => p.file)
      )
      .filter((f, i, arr) => arr.indexOf(f) === i);

    commitChanges(branchName, commitMessage, changedFiles);
    pushBranch(branchName);
  }

  // Step 7: Create PR via git-manager
  try {
    const prTitle =
      spec.pr_template.title ||
      `fix: resolve issue #${spec.issue_number} — ${spec.issue_title}`;
    const prBody =
      spec.pr_template.body || buildPrBody(spec, patches, appliedFixes);
    const pr = await createPR(branchName, prTitle, prBody, spec.target_repo);
    prUrl = pr.url;
  } catch (prErr: unknown) {
    const prMessage = prErr instanceof Error ? prErr.message : String(prErr);
    console.error(`Warning: PR creation failed: ${prMessage}`);
  }

  // Step 8: Determine status
  const hasSuggestions = patches.some((p) => p.suggestions.length > 0);
  const status: WorkerStatus = hasAutoFixes
    ? "success"
    : hasSuggestions
      ? "needs-manual-review"
      : "needs-manual-review";

  const message = hasAutoFixes
    ? `Applied ${appliedFixes.length} automated fix(es) for issue #${spec.issue_number}`
    : hasSuggestions
      ? `Generated patch with suggestions for issue #${spec.issue_number} — manual review required`
      : `Issue #${spec.issue_number} requires manual review — no automated fixes could be derived`;

  return {
    status,
    issue_number: spec.issue_number,
    branch: branchName,
    patch_file: patchFile,
    pr_url: prUrl,
    message,
    applied_fixes: appliedFixes,
  };
}

// ---------------------------------------------------------------------------
// IPC mode — launched by orchestrator via fork()
// ---------------------------------------------------------------------------

function sendResult(success: boolean, error?: string): void {
  const msg: OutgoingMessage = { type: "result", success, error };
  if (process.send) {
    process.send(msg);
  }
}

function setupIpcMode(): void {
  process.on("message", async (msg: IncomingMessage) => {
    if (msg.type !== "spec") {
      return;
    }

    const payload = msg.payload;

    try {
      const specPath = path.resolve(payload.specFile);
      const spec = loadSpecFromFile(specPath);
      const result = await executeFixWorkflow(spec);

      console.log(
        `[Worker ${payload.id}] Fix workflow completed for issue #${spec.issue_number} — status: ${result.status}`
      );
      sendResult(result.status !== "failure");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Worker ${payload.id}] Error: ${errorMsg}`);
      sendResult(false, errorMsg);
    }

    process.exit(0);
  });

  process.on("disconnect", () => {
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// CLI mode — invoked directly with a spec file argument
// ---------------------------------------------------------------------------

async function runCli(): Promise<void> {
  const specPath = process.argv[2];
  if (!specPath) {
    const result: WorkerResult = {
      status: "failure",
      issue_number: 0,
      branch: "",
      patch_file: "",
      pr_url: null,
      message: "Usage: worker.ts <path-to-issue-spec.json>",
      applied_fixes: [],
    };
    console.log(JSON.stringify(result));
    process.exit(1);
  }

  let spec: WorkerSpec;
  try {
    spec = loadSpecFromFile(specPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const result: WorkerResult = {
      status: "failure",
      issue_number: 0,
      branch: "",
      patch_file: "",
      pr_url: null,
      message: `Failed to read spec file: ${message}`,
      applied_fixes: [],
    };
    console.log(JSON.stringify(result));
    process.exit(1);
  }

  try {
    const result = await executeFixWorkflow(spec);
    console.log(JSON.stringify(result));
    if (result.status === "failure") {
      process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const result: WorkerResult = {
      status: "failure",
      issue_number: spec.issue_number,
      branch: spec.branch_name,
      patch_file: "",
      pr_url: null,
      message: `Worker failed: ${message}`,
      applied_fixes: [],
    };
    console.log(JSON.stringify(result));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point — detect IPC (forked) vs CLI (direct) invocation
// ---------------------------------------------------------------------------

if (process.send) {
  setupIpcMode();
} else {
  runCli();
}
