// Build-time GitHub facts for the page (latest release version). Fetched once
// per build; the daily scheduled deploy keeps it fresh. Any failure (offline,
// rate limit) degrades to null so a build never breaks on GitHub.

export interface GitHubStats {
  /** Latest release version without the leading "v", e.g. "0.3.4". */
  version: string | null;
}

const REPO_API = "https://api.github.com/repos/machulav/accountant24";

export async function fetchGitHubStats(
  fetchImpl: typeof fetch = fetch,
  token: string | undefined = process.env.GITHUB_TOKEN,
): Promise<GitHubStats> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "accountant24-website",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const getJson = async (url: string): Promise<Record<string, unknown> | null> => {
    try {
      const response = await fetchImpl(url, { headers });
      if (!response.ok) return null;
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const release = await getJson(`${REPO_API}/releases/latest`);
  const tag = typeof release?.tag_name === "string" ? release.tag_name : null;
  return { version: tag ? tag.replace(/^v/, "") : null };
}
