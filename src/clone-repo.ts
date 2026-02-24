import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, extname, relative } from "path";

const REPO_URL = "https://github.com/CortexLM/cortex-ide.git";
const WORKSPACE_DIR = join(process.cwd(), "workspace", "cortex-ide");
const OUTPUT_DIR = join(process.cwd(), "output");

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "gen"]);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript (JSX)",
  ".js": "JavaScript",
  ".jsx": "JavaScript (JSX)",
  ".rs": "Rust",
  ".toml": "TOML",
  ".json": "JSON",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".md": "Markdown",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".svg": "SVG",
  ".png": "PNG",
  ".jpg": "JPEG",
  ".jpeg": "JPEG",
  ".ico": "ICO",
  ".icns": "ICNS",
  ".woff2": "Font",
  ".woff": "Font",
  ".ttf": "Font",
  ".lock": "Lockfile",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".py": "Python",
  ".go": "Go",
  ".c": "C",
  ".cpp": "C++",
  ".h": "C Header",
  ".hpp": "C++ Header",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".sql": "SQL",
  ".graphql": "GraphQL",
  ".proto": "Protocol Buffers",
  ".xml": "XML",
  ".txt": "Text",
  ".env": "Environment",
  ".gitignore": "Git Config",
  ".editorconfig": "EditorConfig",
  ".prettierrc": "Prettier Config",
  ".eslintrc": "ESLint Config",
};

interface FileEntry {
  path: string;
  size: number;
  language: string;
}

interface RepoStructure {
  repository: string;
  clonedAt: string;
  totalFiles: number;
  files: FileEntry[];
  languageSummary: Record<string, number>;
}

interface TechStackEntry {
  name: string;
  detectedFrom: string;
  version?: string;
}

interface ConfigFile {
  path: string;
  content: string;
}

interface RepoContext {
  repository: string;
  generatedAt: string;
  techStack: TechStackEntry[];
  configFiles: ConfigFile[];
}

function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext && EXTENSION_LANGUAGE_MAP[ext]) {
    return EXTENSION_LANGUAGE_MAP[ext];
  }

  const basename = filePath.split("/").pop() || "";
  if (basename === "Makefile" || basename === "makefile") return "Makefile";
  if (basename === "Dockerfile") return "Dockerfile";
  if (basename === "Vagrantfile") return "Ruby";
  if (basename.startsWith(".env")) return "Environment";
  if (basename === ".gitignore" || basename === ".gitattributes") return "Git Config";

  return "Unknown";
}

function walkDirectory(dir: string, baseDir: string): FileEntry[] {
  const entries: FileEntry[] = [];

  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    if (SKIP_DIRS.has(item)) continue;

    const fullPath = join(dir, item);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      entries.push(...walkDirectory(fullPath, baseDir));
    } else if (stat.isFile()) {
      const relativePath = relative(baseDir, fullPath);
      entries.push({
        path: relativePath,
        size: stat.size,
        language: detectLanguage(relativePath),
      });
    }
  }

  return entries;
}

function cloneRepository(): void {
  if (existsSync(join(WORKSPACE_DIR, ".git"))) {
    console.log(`Repository already cloned at ${WORKSPACE_DIR}, skipping clone.`);
    return;
  }

  const parentDir = join(WORKSPACE_DIR, "..");
  mkdirSync(parentDir, { recursive: true });

  console.log(`Cloning ${REPO_URL} into ${WORKSPACE_DIR}...`);
  execSync(`git clone ${REPO_URL} ${WORKSPACE_DIR}`, { stdio: "inherit" });
  console.log("Clone complete.");
}

function generateRepoStructure(): RepoStructure {
  console.log("Scanning repository structure...");
  const files = walkDirectory(WORKSPACE_DIR, WORKSPACE_DIR);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const languageSummary: Record<string, number> = {};
  for (const file of files) {
    languageSummary[file.language] = (languageSummary[file.language] || 0) + 1;
  }

  return {
    repository: REPO_URL,
    clonedAt: new Date().toISOString(),
    totalFiles: files.length,
    files,
    languageSummary,
  };
}

function detectTechStack(): TechStackEntry[] {
  const stack: TechStackEntry[] = [];

  const pkgPath = join(WORKSPACE_DIR, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      stack.push({ name: "Node.js", detectedFrom: "package.json", version: pkg.version });

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps["typescript"] || allDeps["tsx"]) {
        stack.push({ name: "TypeScript", detectedFrom: "package.json", version: allDeps["typescript"] });
      }
      if (allDeps["solid-js"]) {
        stack.push({ name: "SolidJS", detectedFrom: "package.json", version: allDeps["solid-js"] });
      }
      if (allDeps["vite"]) {
        stack.push({ name: "Vite", detectedFrom: "package.json", version: allDeps["vite"] });
      }
      if (allDeps["tailwindcss"] || allDeps["@tailwindcss/vite"]) {
        stack.push({ name: "Tailwind CSS", detectedFrom: "package.json" });
      }
      if (allDeps["vitest"]) {
        stack.push({ name: "Vitest", detectedFrom: "package.json", version: allDeps["vitest"] });
      }
      if (allDeps["@tauri-apps/api"]) {
        stack.push({ name: "Tauri (Frontend)", detectedFrom: "package.json", version: allDeps["@tauri-apps/api"] });
      }
      if (allDeps["monaco-editor"] || allDeps["@monaco-editor/loader"]) {
        stack.push({ name: "Monaco Editor", detectedFrom: "package.json" });
      }
      if (allDeps["@xterm/xterm"]) {
        stack.push({ name: "xterm.js", detectedFrom: "package.json", version: allDeps["@xterm/xterm"] });
      }
    } catch {
      stack.push({ name: "Node.js", detectedFrom: "package.json" });
    }
  }

  const cargoPath = join(WORKSPACE_DIR, "src-tauri", "Cargo.toml");
  if (existsSync(cargoPath)) {
    stack.push({ name: "Rust", detectedFrom: "src-tauri/Cargo.toml" });
    const cargoContent = readFileSync(cargoPath, "utf-8");
    const tauriMatch = cargoContent.match(/tauri\s*=\s*\{\s*version\s*=\s*"([^"]+)"/);
    if (tauriMatch) {
      stack.push({ name: "Tauri (Backend)", detectedFrom: "src-tauri/Cargo.toml", version: tauriMatch[1] });
    }
  }

  const tauriConfPath = join(WORKSPACE_DIR, "src-tauri", "tauri.conf.json");
  if (existsSync(tauriConfPath)) {
    try {
      const conf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
      stack.push({ name: "Tauri App", detectedFrom: "src-tauri/tauri.conf.json", version: conf.version });
    } catch {
      stack.push({ name: "Tauri App", detectedFrom: "src-tauri/tauri.conf.json" });
    }
  }

  const mcpPkgPath = join(WORKSPACE_DIR, "mcp-server", "package.json");
  if (existsSync(mcpPkgPath)) {
    try {
      const mcpPkg = JSON.parse(readFileSync(mcpPkgPath, "utf-8"));
      const mcpDeps = { ...mcpPkg.dependencies, ...mcpPkg.devDependencies };
      if (mcpDeps["@modelcontextprotocol/sdk"]) {
        stack.push({ name: "MCP Server", detectedFrom: "mcp-server/package.json", version: mcpDeps["@modelcontextprotocol/sdk"] });
      }
    } catch {}
  }

  if (existsSync(join(WORKSPACE_DIR, "vite.config.ts"))) {
    stack.push({ name: "Vite Config", detectedFrom: "vite.config.ts" });
  }

  if (existsSync(join(WORKSPACE_DIR, "vitest.config.ts"))) {
    stack.push({ name: "Vitest Config", detectedFrom: "vitest.config.ts" });
  }

  return stack;
}

function extractConfigFiles(): ConfigFile[] {
  const configs: ConfigFile[] = [];

  const configPaths = [
    "package.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "vite.config.ts",
    "vitest.config.ts",
    ".releaserc.json",
    ".env.example",
    ".gitignore",
    "AGENTS.md",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/capabilities/default.json",
    "src-tauri/AGENTS.md",
    "mcp-server/package.json",
    "mcp-server/tsconfig.json",
    "mcp-server/AGENTS.md",
    "src/AGENTS.md",
    "index.html",
    "VERSION",
  ];

  for (const configPath of configPaths) {
    const fullPath = join(WORKSPACE_DIR, configPath);
    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.size > 100_000) {
          configs.push({
            path: configPath,
            content: `[File too large: ${stat.size} bytes — skipped]`,
          });
        } else {
          configs.push({
            path: configPath,
            content: readFileSync(fullPath, "utf-8"),
          });
        }
      } catch {
        configs.push({ path: configPath, content: "[Error reading file]" });
      }
    }
  }

  return configs;
}

function main(): void {
  console.log("=== Cortex IDE Repository Cloner & Analyzer ===\n");

  cloneRepository();

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const structure = generateRepoStructure();
  const structurePath = join(OUTPUT_DIR, "repo-structure.json");
  writeFileSync(structurePath, JSON.stringify(structure, null, 2));
  console.log(`Wrote ${structure.totalFiles} files to ${structurePath}`);
  console.log("Language summary:", structure.languageSummary);

  const techStack = detectTechStack();
  const configFiles = extractConfigFiles();

  const context: RepoContext = {
    repository: REPO_URL,
    generatedAt: new Date().toISOString(),
    techStack,
    configFiles,
  };

  const contextPath = join(OUTPUT_DIR, "repo-context.json");
  writeFileSync(contextPath, JSON.stringify(context, null, 2));
  console.log(`\nWrote ${configFiles.length} config files and ${techStack.length} tech stack entries to ${contextPath}`);

  console.log("\nTech stack detected:");
  for (const entry of techStack) {
    console.log(`  - ${entry.name}${entry.version ? ` (${entry.version})` : ""} [from ${entry.detectedFrom}]`);
  }

  console.log("\n=== Done ===");
}

main();
