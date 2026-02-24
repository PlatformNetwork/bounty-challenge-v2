import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = join(process.cwd(), "output");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubLabel {
  name: string;
  color?: string;
  description?: string;
}

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  labels: (string | GitHubLabel)[];
  state: string;
  created_at: string;
  updated_at: string;
  html_url?: string;
  user?: { login: string };
  [key: string]: unknown;
}

interface RepoContext {
  repository?: string;
  owner?: string;
  repo?: string;
  description?: string;
  default_branch?: string;
  techStack?: unknown[];
  configFiles?: unknown[];
  [key: string]: unknown;
}

interface FileEntry {
  path: string;
  size?: number;
  language?: string;
}

interface RepoStructure {
  files?: (string | FileEntry)[];
  tree?: string[];
  totalFiles?: number;
  [key: string]: unknown;
}

interface ParsedBody {
  description: string;
  steps_to_reproduce: string;
  expected_behavior: string;
  mentioned_files: string[];
}

type IssueType = "bug-fix" | "feature" | "refactor" | "UI" | "performance";
type Complexity = "simple" | "medium" | "complex";

interface AnalyzedIssue extends RawIssue {
  affected_files: string[];
  issue_type: IssueType;
  complexity: Complexity;
  keywords: string[];
  parsed_body: ParsedBody;
  issue_number: number;
  issue_title: string;
  issue_body: string;
  issue_url: string;
  repo_context: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers – read input files
// ---------------------------------------------------------------------------

function readJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function labelName(label: string | GitHubLabel): string {
  return typeof label === "string" ? label : label.name;
}

// ---------------------------------------------------------------------------
// Body parsing – extract structured sections from issue markdown
// ---------------------------------------------------------------------------

const SECTION_PATTERNS: Record<string, RegExp[]> = {
  description: [
    /###?\s*description\s*\n([\s\S]*?)(?=\n###?\s|\n---|\n\*\*[A-Z]|$)/i,
    /##?\s*bug\s*report\s*\n([\s\S]*?)(?=\n###?\s|$)/i,
  ],
  steps_to_reproduce: [
    /###?\s*steps?\s*to\s*reproduce\s*\n([\s\S]*?)(?=\n###?\s|\n---|\n\*\*[A-Z]|$)/i,
    /###?\s*reproduction\s*(?:steps?)?\s*\n([\s\S]*?)(?=\n###?\s|$)/i,
    /###?\s*how\s*to\s*reproduce\s*\n([\s\S]*?)(?=\n###?\s|$)/i,
  ],
  expected_behavior: [
    /###?\s*expected\s*(?:behavior|behaviour|result)\s*\n([\s\S]*?)(?=\n###?\s|\n---|\n\*\*[A-Z]|$)/i,
    /###?\s*what\s*(?:you\s*)?expected\s*\n([\s\S]*?)(?=\n###?\s|$)/i,
  ],
};

const FILE_MENTION_PATTERNS = [
  /`([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,10})`/g,
  /(?:^|\s)((?:src|lib|bin|crates?)\/[a-zA-Z0-9_\-/.]+)/gm,
  /(?:file|in|at|see)\s+`?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]{1,10})`?/gi,
];

function extractSection(body: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return "";
}

function extractMentionedFiles(body: string): string[] {
  const files = new Set<string>();
  for (const pattern of FILE_MENTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      const candidate = match[1];
      if (
        candidate &&
        !candidate.startsWith("http") &&
        !candidate.startsWith("//") &&
        /\.[a-zA-Z]{1,10}$/.test(candidate)
      ) {
        files.add(candidate);
      }
    }
  }
  return [...files];
}

function parseIssueBody(body: string | null): ParsedBody {
  if (!body) {
    return {
      description: "",
      steps_to_reproduce: "",
      expected_behavior: "",
      mentioned_files: [],
    };
  }
  return {
    description: extractSection(body, SECTION_PATTERNS.description) || body.slice(0, 500).trim(),
    steps_to_reproduce: extractSection(body, SECTION_PATTERNS.steps_to_reproduce),
    expected_behavior: extractSection(body, SECTION_PATTERNS.expected_behavior),
    mentioned_files: extractMentionedFiles(body),
  };
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must", "to", "of",
  "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "out", "off",
  "over", "under", "again", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "just", "because", "but",
  "and", "or", "if", "while", "about", "up", "this", "that", "these",
  "those", "it", "its", "i", "me", "my", "we", "our", "you", "your",
  "he", "she", "they", "them", "what", "which", "who", "whom",
]);

const TECHNICAL_TERMS = new Set([
  "tui", "cli", "mcp", "lsp", "wasm", "plugin", "agent", "session",
  "provider", "model", "render", "widget", "keybinding", "toast",
  "sandbox", "proxy", "batch", "snapshot", "migration", "config",
  "storage", "engine", "command", "hook", "event", "permission",
  "auth", "login", "api", "server", "client", "protocol", "network",
  "file", "search", "review", "feedback", "compact", "resume",
  "update", "shell", "exec", "process", "skills", "forge",
  "orchestration", "validation", "security", "quality",
  "panel", "modal", "input", "output", "stream", "async", "sync",
  "error", "crash", "panic", "hang", "freeze", "slow", "memory",
  "leak", "cpu", "performance", "latency", "timeout",
]);

function extractKeywords(title: string, body: string | null): string[] {
  const text = `${title} ${body ?? ""}`.toLowerCase();
  const tokens = text.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const keywordSet = new Set<string>();

  for (const token of tokens) {
    if (STOP_WORDS.has(token)) continue;
    if (TECHNICAL_TERMS.has(token)) {
      keywordSet.add(token);
      continue;
    }
    if (token.startsWith("cortex")) {
      keywordSet.add(token);
      continue;
    }
    if (token.length >= 4 && !STOP_WORDS.has(token)) {
      keywordSet.add(token);
    }
  }

  return [...keywordSet].slice(0, 30);
}

// ---------------------------------------------------------------------------
// Component name mapping for cortex codebase
// ---------------------------------------------------------------------------

const COMPONENT_KEYWORDS: Record<string, string[]> = {
  "cortex-tui": ["tui", "terminal", "render", "widget", "panel", "modal", "ui", "display", "view", "screen", "layout", "theme", "color", "style", "cursor", "scroll"],
  "cortex-engine": ["engine", "command", "slash", "handler", "dispatch", "session", "turn", "delegate"],
  "cortex-cli": ["cli", "argument", "flag", "subcommand", "main", "entry"],
  "cortex-mcp-client": ["mcp", "mcp-client", "tool-call", "protocol"],
  "cortex-mcp-server": ["mcp-server", "server", "stdio"],
  "cortex-plugins": ["plugin", "wasm-plugin", "hook", "registry", "manifest"],
  "cortex-agents": ["agent", "forge", "orchestration", "validation-agent", "security-agent", "quality-agent"],
  "cortex-config": ["config", "configuration", "settings", "preference", "profile"],
  "cortex-skills": ["skill", "watcher", "file-watch"],
  "cortex-lsp": ["lsp", "language-server", "completion", "diagnostic", "hover"],
  "cortex-storage": ["storage", "database", "persist", "cache", "store"],
  "cortex-network-proxy": ["proxy", "network", "http", "request", "response"],
  "cortex-sandbox": ["sandbox", "isolation", "container", "security"],
  "cortex-batch": ["batch", "parallel", "concurrent", "queue"],
  "cortex-login": ["login", "auth", "authentication", "credential", "token"],
  "cortex-apply-patch": ["patch", "diff", "apply", "edit"],
  "cortex-core": ["core", "common", "util", "shared"],
  "cortex-app-server": ["app-server", "api", "endpoint", "route", "rest"],
  "cortex-exec": ["exec", "execute", "shell", "process", "spawn"],
  "cortex-review": ["review", "code-review", "feedback"],
  "cortex-share": ["share", "export", "collaborate"],
  "cortex-snapshot": ["snapshot", "capture", "state"],
  "cortex-update": ["update", "upgrade", "version", "release"],
  "cortex-file-search": ["file-search", "search", "find", "grep", "ripgrep"],
};

// ---------------------------------------------------------------------------
// Affected file matching against repo structure
// ---------------------------------------------------------------------------

function findAffectedFiles(
  keywords: string[],
  mentionedFiles: string[],
  fileTree: string[],
): string[] {
  const affected = new Set<string>();

  for (const mentioned of mentionedFiles) {
    const normalized = mentioned.replace(/^\/+/, "");
    for (const treePath of fileTree) {
      if (
        treePath.endsWith(normalized) ||
        treePath.includes(normalized) ||
        treePath.endsWith(`/${normalized}`)
      ) {
        affected.add(treePath);
      }
    }
  }

  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  for (const [component, componentKeywords] of Object.entries(COMPONENT_KEYWORDS)) {
    const matchCount = lowerKeywords.filter((kw) =>
      componentKeywords.some((ck) => kw === ck || kw.includes(ck) || ck.includes(kw)),
    ).length;

    if (matchCount >= 2) {
      for (const treePath of fileTree) {
        if (treePath.includes(component)) {
          affected.add(treePath);
        }
      }
    }
  }

  for (const keyword of lowerKeywords) {
    if (keyword.startsWith("cortex-") || keyword.startsWith("cortex_")) {
      const component = keyword.replace(/_/g, "-");
      for (const treePath of fileTree) {
        if (treePath.includes(component)) {
          affected.add(treePath);
        }
      }
    }
  }

  for (const keyword of lowerKeywords) {
    for (const treePath of fileTree) {
      const fileName = treePath.split("/").pop() ?? "";
      const baseName = fileName.replace(/\.[^.]+$/, "").toLowerCase();
      if (baseName === keyword || baseName.replace(/[-_]/g, "") === keyword.replace(/[-_]/g, "")) {
        affected.add(treePath);
      }
    }
  }

  return [...affected].sort();
}

// ---------------------------------------------------------------------------
// Issue type classification
// ---------------------------------------------------------------------------

const TYPE_SIGNALS: Record<IssueType, { titlePatterns: RegExp[]; labelPatterns: RegExp[]; bodyPatterns: RegExp[] }> = {
  "bug-fix": {
    titlePatterns: [/\[bug\]/i, /\bfix\b/i, /\bbug\b/i, /\bcrash/i, /\berror\b/i, /\bbroken\b/i, /\bfail/i],
    labelPatterns: [/bug/i, /defect/i, /fix/i],
    bodyPatterns: [/steps?\s*to\s*reproduce/i, /actual\s*behav/i, /expected\s*behav/i, /stack\s*trace/i, /error\s*message/i, /panic/i, /crash/i],
  },
  feature: {
    titlePatterns: [/\[feature\]/i, /\bfeat\b/i, /\badd\b/i, /\bnew\b/i, /\bimplement/i, /\bsupport\b/i],
    labelPatterns: [/enhancement/i, /feature/i, /suggestion/i],
    bodyPatterns: [/use\s*case/i, /proposed\s*solution/i, /i\s*want\s*to/i, /would\s*be\s*nice/i, /as\s*a\s*user/i],
  },
  refactor: {
    titlePatterns: [/\brefactor/i, /\bclean\s*up/i, /\brestructure/i, /\breorganize/i, /\bsimplif/i, /\bdead\s*code/i],
    labelPatterns: [/refactor/i, /cleanup/i, /tech[\s-]*debt/i],
    bodyPatterns: [/refactor/i, /dead\s*code/i, /clean\s*up/i, /simplif/i, /restructure/i, /code\s*quality/i],
  },
  UI: {
    titlePatterns: [/\bui\b/i, /\bux\b/i, /\btui\b/i, /\bdisplay/i, /\brender/i, /\bvisual/i, /\blayout/i, /\btheme/i, /\bstyle/i],
    labelPatterns: [/ui/i, /ux/i, /visual/i, /tui/i, /frontend/i],
    bodyPatterns: [/display/i, /render/i, /visual/i, /layout/i, /widget/i, /panel/i, /modal/i, /screen/i, /terminal\s*size/i],
  },
  performance: {
    titlePatterns: [/\[perf\]/i, /\bperformance/i, /\bslow/i, /\blatency/i, /\bmemory/i, /\bcpu\b/i, /\boptimiz/i],
    labelPatterns: [/performance/i, /perf/i, /optimization/i, /speed/i],
    bodyPatterns: [/performance/i, /slow/i, /latency/i, /memory\s*usage/i, /cpu\s*usage/i, /response\s*time/i, /benchmark/i],
  },
};

function classifyIssueType(issue: RawIssue): IssueType {
  const scores: Record<IssueType, number> = {
    "bug-fix": 0,
    feature: 0,
    refactor: 0,
    UI: 0,
    performance: 0,
  };

  const labels = issue.labels.map(labelName);
  const body = issue.body ?? "";

  for (const [type, signals] of Object.entries(TYPE_SIGNALS) as [IssueType, typeof TYPE_SIGNALS[IssueType]][]) {
    for (const pattern of signals.titlePatterns) {
      if (pattern.test(issue.title)) scores[type] += 3;
    }
    for (const pattern of signals.labelPatterns) {
      if (labels.some((l) => pattern.test(l))) scores[type] += 4;
    }
    for (const pattern of signals.bodyPatterns) {
      if (pattern.test(body)) scores[type] += 1;
    }
  }

  let maxType: IssueType = "bug-fix";
  let maxScore = 0;
  for (const [type, score] of Object.entries(scores) as [IssueType, number][]) {
    if (score > maxScore) {
      maxScore = score;
      maxType = type;
    }
  }

  return maxType;
}

// ---------------------------------------------------------------------------
// Complexity estimation
// ---------------------------------------------------------------------------

function estimateComplexity(affectedFiles: string[], body: string | null): Complexity {
  const fileCount = affectedFiles.length;
  const bodyLength = (body ?? "").length;

  if (fileCount <= 2 && bodyLength < 500) return "simple";
  if (fileCount <= 5 || bodyLength < 1500) return "medium";
  return "complex";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const issuesPath = join(OUTPUT_DIR, "issues.json");
  const repoContextPath = join(OUTPUT_DIR, "repo-context.json");
  const repoStructurePath = join(OUTPUT_DIR, "repo-structure.json");

  if (!existsSync(issuesPath)) {
    console.error(`Error: ${issuesPath} not found. Run Phase 1 first to generate issues.json.`);
    process.exit(1);
  }

  const issues = readJson<RawIssue[]>(issuesPath);
  console.log(`Loaded ${issues.length} issues from ${issuesPath}`);

  let repoContext: RepoContext | null = null;
  if (existsSync(repoContextPath)) {
    repoContext = readJson<RepoContext>(repoContextPath);
    const repoName = repoContext.repository ?? repoContext.repo ?? "unknown";
    console.log(`Loaded repo context from ${repoContextPath} (repo: ${repoName})`);
  } else {
    console.warn(`Warning: ${repoContextPath} not found, proceeding without repo context.`);
  }

  let fileTree: string[] = [];
  if (existsSync(repoStructurePath)) {
    const structure = readJson<RepoStructure>(repoStructurePath);
    const rawFiles = structure.files ?? structure.tree ?? [];
    fileTree = rawFiles.map((f) => (typeof f === "string" ? f : f.path));
    console.log(`Loaded ${fileTree.length} files from repo structure.`);
  } else {
    console.warn(`Warning: ${repoStructurePath} not found, affected file matching will be limited.`);
  }

  const analyzed: AnalyzedIssue[] = issues.map((issue) => {
    const parsed = parseIssueBody(issue.body);
    const keywords = extractKeywords(issue.title, issue.body);
    const affectedFiles = findAffectedFiles(keywords, parsed.mentioned_files, fileTree);
    const issueType = classifyIssueType(issue);
    const complexity = estimateComplexity(affectedFiles, issue.body);

    return {
      ...issue,
      affected_files: affectedFiles,
      issue_type: issueType,
      complexity,
      keywords,
      parsed_body: parsed,
      issue_number: issue.number,
      issue_title: issue.title,
      issue_body: issue.body ?? "",
      issue_url: issue.html_url ?? "",
      repo_context: (repoContext as Record<string, unknown>) ?? {},
    };
  });

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = join(OUTPUT_DIR, "analyzed-issues.json");
  writeFileSync(outputPath, JSON.stringify(analyzed, null, 2), "utf-8");

  console.log(`\nAnalysis complete.`);
  console.log(`  Total issues analyzed: ${analyzed.length}`);

  const typeCounts: Record<string, number> = {};
  const complexityCounts: Record<string, number> = {};
  for (const a of analyzed) {
    typeCounts[a.issue_type] = (typeCounts[a.issue_type] ?? 0) + 1;
    complexityCounts[a.complexity] = (complexityCounts[a.complexity] ?? 0) + 1;
  }

  console.log(`  By type:`);
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  console.log(`  By complexity:`);
  for (const [level, count] of Object.entries(complexityCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${level}: ${count}`);
  }

  console.log(`\nOutput written to ${outputPath}`);
}

main();
