import { execSync } from "node:child_process";
import { request } from "node:https";
import { resolve } from "node:path";

const WORKSPACE_DIR = resolve(process.cwd(), "workspace", "cortex-ide");

const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?: .+/;

function getGHToken(): string {
  const token = process.env.GH_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN environment variable is not set");
  }
  return token;
}

function execGit(command: string): string {
  return execSync(command, {
    cwd: WORKSPACE_DIR,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function getDefaultBranch(): string {
  try {
    const ref = execGit("git symbolic-ref refs/remotes/origin/HEAD");
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    const branches = execGit("git branch -r");
    if (branches.includes("origin/main")) {
      return "main";
    }
    if (branches.includes("origin/master")) {
      return "master";
    }
    throw new Error(
      "Could not determine default branch: neither main nor master found"
    );
  }
}

function getOriginUrl(): string {
  return execGit("git remote get-url origin");
}

export function resetToMain(): void {
  try {
    execGit("git fetch origin");
    const defaultBranch = getDefaultBranch();
    execGit(`git checkout ${defaultBranch}`);
    execGit(`git reset --hard origin/${defaultBranch}`);
    execGit("git clean -fd");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to reset to main: ${message}`);
  }
}

export function createBranch(branchName: string): void {
  try {
    execGit("git fetch origin");
    const defaultBranch = getDefaultBranch();
    execGit(`git checkout ${defaultBranch}`);
    execGit(`git reset --hard origin/${defaultBranch}`);
    execGit(`git checkout -b ${branchName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create branch '${branchName}': ${message}`);
  }
}

export function commitChanges(
  branchName: string,
  message: string,
  files: string[]
): void {
  if (!CONVENTIONAL_COMMIT_RE.test(message)) {
    throw new Error(
      `Commit message does not follow conventional commit format: '${message}'. ` +
        "Expected format: type(scope): description (e.g., feat(auth): add login)"
    );
  }

  try {
    execGit(`git checkout ${branchName}`);

    for (const file of files) {
      execGit(`git add -- "${file}"`);
    }

    execGit(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to commit changes on branch '${branchName}': ${msg}`
    );
  }
}

export function pushBranch(branchName: string): void {
  const token = getGHToken();
  const originUrl = getOriginUrl();

  try {
    execGit(`git checkout ${branchName}`);

    const authenticatedUrl = originUrl.replace(
      /https:\/\/(.*@)?github\.com/,
      `https://${token}@github.com`
    );
    execGit(`git remote set-url origin ${authenticatedUrl}`);

    try {
      execGit(`git push -u origin ${branchName}`);
    } finally {
      execGit(`git remote set-url origin ${originUrl}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to push branch '${branchName}': ${message}`);
  }
}

export function createPR(
  branchName: string,
  title: string,
  body: string,
  repo: string
): Promise<{ number: number; url: string }> {
  const token = getGHToken();
  const defaultBranch = getDefaultBranch();

  const payload = JSON.stringify({
    title,
    body,
    head: branchName,
    base: defaultBranch,
  });

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.github.com",
        path: `/repos/${repo}/pulls`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "bounty-challenge-git-manager",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new Error(
                  `GitHub API error (${res.statusCode}): ${parsed.message || data}`
                )
              );
              return;
            }
            resolve({
              number: parsed.number,
              url: parsed.html_url,
            });
          } catch {
            reject(
              new Error(`Failed to parse GitHub API response: ${data}`)
            );
          }
        });
      }
    );

    req.on("error", (error: Error) => {
      reject(
        new Error(`Failed to create PR for '${branchName}': ${error.message}`)
      );
    });

    req.write(payload);
    req.end();
  });
}
