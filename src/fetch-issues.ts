import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: GitHubLabel[];
}

interface FilteredIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: string[];
}

const API_URL =
  "https://api.github.com/repos/PlatformNetwork/bounty-challenge/issues?labels=valid,ide&state=open&per_page=100";

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function fetchAllIssues(): Promise<GitHubIssue[]> {
  const allIssues: GitHubIssue[] = [];
  let url: string | null = API_URL;

  while (url) {
    console.log(`Fetching: ${url}`);
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bounty-challenge-v2",
      },
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
    }

    const issues: GitHubIssue[] = await response.json();
    allIssues.push(...issues);
    console.log(`  Fetched ${issues.length} issues (total: ${allIssues.length})`);

    url = parseNextLink(response.headers.get("link"));
  }

  return allIssues;
}

function filterIssues(issues: GitHubIssue[]): FilteredIssue[] {
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    html_url: issue.html_url,
    labels: issue.labels.map((label) => label.name),
  }));
}

async function main(): Promise<void> {
  console.log("Fetching open issues with labels: valid, ide ...");

  const rawIssues = await fetchAllIssues();
  const filtered = filterIssues(rawIssues);

  const outputPath = join(process.cwd(), "output", "issues.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(filtered, null, 2));

  console.log(`\nWrote ${filtered.length} issues to ${outputPath}`);
}

main().catch((err) => {
  console.error("Error fetching issues:", err);
  process.exit(1);
});
