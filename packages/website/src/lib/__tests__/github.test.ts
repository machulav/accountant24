import { describe, expect, it, vi } from "vitest";
import { fetchGitHubStats } from "../github";

function fakeFetch(responses: Record<string, { ok: boolean; body?: unknown }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const entry = responses[String(input)];
    if (!entry) throw new Error(`unexpected url ${String(input)}`);
    return { ok: entry.ok, json: async () => entry.body } as Response;
  }) as unknown as typeof fetch;
}

const RELEASE = "https://api.github.com/repos/machulav/accountant24/releases/latest";

function headersOf(fetchImpl: typeof fetch): Record<string, string> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers;
}

describe("fetchGitHubStats()", () => {
  it("should return the latest version without the leading v", async () => {
    const fetchImpl = fakeFetch({ [RELEASE]: { ok: true, body: { tag_name: "v0.3.4" } } });
    expect(await fetchGitHubStats(fetchImpl, "")).toEqual({ version: "0.3.4" });
  });

  it("should keep a tag that has no v prefix as is", async () => {
    const fetchImpl = fakeFetch({ [RELEASE]: { ok: true, body: { tag_name: "1.0.0" } } });
    expect(await fetchGitHubStats(fetchImpl, "")).toEqual({ version: "1.0.0" });
  });

  it("should return null when there is no release yet", async () => {
    const fetchImpl = fakeFetch({ [RELEASE]: { ok: false } });
    expect(await fetchGitHubStats(fetchImpl, "")).toEqual({ version: null });
  });

  it("should return null when the network is unavailable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchGitHubStats(fetchImpl, "")).toEqual({ version: null });
  });

  it("should return null when the API returns an unexpected shape", async () => {
    const fetchImpl = fakeFetch({ [RELEASE]: { ok: true, body: { tag_name: 42 } } });
    expect(await fetchGitHubStats(fetchImpl, "")).toEqual({ version: null });
  });

  it("should send a bearer token when one is given", async () => {
    const fetchImpl = fakeFetch({ [RELEASE]: { ok: true, body: { tag_name: "v1" } } });
    await fetchGitHubStats(fetchImpl, "ghp_secret");
    expect(headersOf(fetchImpl).Authorization).toBe("Bearer ghp_secret");
  });

  it("should not send an Authorization header without a token", async () => {
    const fetchImpl = fakeFetch({ [RELEASE]: { ok: true, body: { tag_name: "v1" } } });
    await fetchGitHubStats(fetchImpl, "");
    expect(headersOf(fetchImpl)).not.toHaveProperty("Authorization");
  });

  it("should read the token from GITHUB_TOKEN by default", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_from_env");
    const fetchImpl = fakeFetch({ [RELEASE]: { ok: true, body: { tag_name: "v1" } } });
    await fetchGitHubStats(fetchImpl);
    expect(headersOf(fetchImpl).Authorization).toBe("Bearer ghp_from_env");
    vi.unstubAllEnvs();
  });
});
