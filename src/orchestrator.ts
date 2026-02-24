import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fork, type ChildProcess } from "node:child_process";

const MAX_CONCURRENCY = 8;
const MAX_RETRIES = 1;

const PROJECT_ROOT = resolve(process.cwd());
const MANIFEST_PATH = join(PROJECT_ROOT, "output", "dispatch-manifest.json");
const RESULTS_PATH = join(PROJECT_ROOT, "output", "results.json");
const WORKER_SCRIPT = join(PROJECT_ROOT, "src", "worker.ts");

interface ManifestSpec {
  issue_number: number;
  issue_title: string;
  spec_file: string;
  branch_name: string;
  target_repo: string;
}

interface DispatchManifest {
  generated_at: string;
  total_specs: number;
  specs: ManifestSpec[];
}

interface WorkerSpec {
  id: string;
  issueNumber: number;
  repo: string;
  branch: string;
  title: string;
  specFile: string;
}

type WorkerStatus = "pending" | "in-progress" | "completed" | "failed";

interface WorkerResult {
  id: string;
  issueNumber: number;
  status: WorkerStatus;
  branch: string;
  error?: string;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
}

interface WorkerMessage {
  type: "result";
  success: boolean;
  error?: string;
}

function loadManifest(): WorkerSpec[] {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(raw) as DispatchManifest;

  return manifest.specs.map((spec) => ({
    id: `worker-${spec.issue_number}`,
    issueNumber: spec.issue_number,
    repo: spec.target_repo,
    branch: spec.branch_name,
    title: spec.issue_title,
    specFile: spec.spec_file,
  }));
}

function formatProgress(index: number, total: number, spec: WorkerSpec, status: string): string {
  return `[${index}/${total}] Fixing issue #${spec.issueNumber} - ${status}`;
}

function spawnWorker(spec: WorkerSpec): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const child: ChildProcess = fork(WORKER_SCRIPT, [], {
      execArgv: ["--import", "tsx"],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    child.send({ type: "spec", payload: spec });

    child.on("message", (msg) => {
      if (!resolved) {
        resolved = true;
        resolve(msg as WorkerMessage);
      }
    });

    child.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on("exit", (code: number | null) => {
      if (!resolved) {
        resolved = true;
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        } else {
          resolve({ type: "result", success: true });
        }
      }
    });
  });
}

async function runWorkerWithRetry(
  spec: WorkerSpec,
  index: number,
  total: number,
): Promise<WorkerResult> {
  const result: WorkerResult = {
    id: spec.id,
    issueNumber: spec.issueNumber,
    status: "pending",
    branch: spec.branch,
    attempts: 0,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    result.attempts = attempt + 1;
    result.status = "in-progress";
    result.startedAt = new Date().toISOString();

    const attemptLabel = attempt > 0 ? ` (retry ${attempt})` : "";
    console.log(formatProgress(index, total, spec, `in progress${attemptLabel}`));

    try {
      const msg = await spawnWorker(spec);

      if (msg.success) {
        result.status = "completed";
        result.completedAt = new Date().toISOString();
        result.duration = Date.now() - new Date(result.startedAt).getTime();
        console.log(formatProgress(index, total, spec, "completed"));
        return result;
      }

      result.error = msg.error || "Worker returned failure";

      if (attempt < MAX_RETRIES) {
        console.log(formatProgress(index, total, spec, `failed, retrying... (${result.error})`));
        continue;
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);

      if (attempt < MAX_RETRIES) {
        console.log(formatProgress(index, total, spec, `failed, retrying... (${result.error})`));
        continue;
      }
    }
  }

  result.status = "failed";
  result.completedAt = new Date().toISOString();
  result.duration = result.startedAt
    ? Date.now() - new Date(result.startedAt).getTime()
    : 0;
  console.log(formatProgress(index, total, spec, `failed (${result.error})`));
  return result;
}

class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

function writeResults(results: WorkerResult[]): void {
  const outputDir = dirname(RESULTS_PATH);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(RESULTS_PATH, JSON.stringify({ results }, null, 2));
}

async function main(): Promise<void> {
  console.log("=== Bounty Challenge Worker Orchestrator ===\n");

  const workers = loadManifest();
  const total = workers.length;

  if (total === 0) {
    console.log("No workers to dispatch. Manifest is empty.");
    writeResults([]);
    return;
  }

  console.log(`Loaded ${total} worker specs from manifest`);
  console.log(`Concurrency limit: ${MAX_CONCURRENCY}`);
  console.log(`Max retries per worker: ${MAX_RETRIES}\n`);

  const limiter = new ConcurrencyLimiter(MAX_CONCURRENCY);
  const results: WorkerResult[] = [];

  const tasks = workers.map(async (spec, i) => {
    await limiter.acquire();
    try {
      const result = await runWorkerWithRetry(spec, i + 1, total);
      results.push(result);
    } finally {
      limiter.release();
    }
  });

  await Promise.all(tasks);

  results.sort((a, b) => a.issueNumber - b.issueNumber);

  writeResults(results);

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log("\n=== Dispatch Summary ===");
  console.log(`Total:     ${total}`);
  console.log(`Completed: ${completed}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Results:   ${RESULTS_PATH}\n`);

  if (failed > 0) {
    console.log("Failed workers:");
    results
      .filter((r) => r.status === "failed")
      .forEach((r) => {
        console.log(`  - Issue #${r.issueNumber}: ${r.error}`);
      });
    console.log("");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Orchestrator fatal error:", err);
  process.exit(2);
});
