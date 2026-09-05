import { describe, expect, it } from "vitest";
import { toMintlifyRequest } from "../proxy";

const target = { mintlifyHost: "accountant24.mintlify.site", siteHost: "accountant24.ai" };

describe("toMintlifyRequest()", () => {
  it("should keep the path and query but address the request to the Mintlify host over https", () => {
    const proxied = toMintlifyRequest(new Request("https://accountant24.ai/docs/quickstart?x=1"), target);
    expect(proxied.url).toBe("https://accountant24.mintlify.site/docs/quickstart?x=1");
  });

  it("should drop the local port and upgrade http when developing locally", () => {
    const proxied = toMintlifyRequest(new Request("http://localhost:8787/docs"), target);
    expect(proxied.url).toBe("https://accountant24.mintlify.site/docs");
  });

  it("should tell Mintlify the public host and scheme via X-Forwarded-* headers", () => {
    const proxied = toMintlifyRequest(new Request("http://accountant24.ai/docs"), target);
    expect(proxied.headers.get("X-Forwarded-Host")).toBe("accountant24.ai");
    expect(proxied.headers.get("X-Forwarded-Proto")).toBe("https");
  });

  it("should forward the visitor IP header Cloudflare provides", () => {
    const request = new Request("https://accountant24.ai/docs", { headers: { "CF-Connecting-IP": "203.0.113.7" } });
    expect(toMintlifyRequest(request, target).headers.get("CF-Connecting-IP")).toBe("203.0.113.7");
  });

  it("should forward ordinary request headers such as Accept and Cookie", () => {
    const request = new Request("https://accountant24.ai/docs", {
      headers: { Accept: "text/html", Cookie: "theme=dark", "Accept-Language": "en" },
    });
    const proxied = toMintlifyRequest(request, target);
    expect(proxied.headers.get("Accept")).toBe("text/html");
    expect(proxied.headers.get("Cookie")).toBe("theme=dark");
    expect(proxied.headers.get("Accept-Language")).toBe("en");
  });

  it("should not forward the visitor's Host or other hop-by-hop headers", () => {
    const request = new Request("https://accountant24.ai/docs", {
      headers: { Host: "accountant24.ai", Connection: "keep-alive", "Keep-Alive": "timeout=5", Upgrade: "h2c" },
    });
    const proxied = toMintlifyRequest(request, target);
    expect(proxied.headers.get("Host")).toBeNull();
    expect(proxied.headers.has("Connection")).toBe(false);
    expect(proxied.headers.has("Keep-Alive")).toBe(false);
    expect(proxied.headers.has("Upgrade")).toBe(false);
  });

  it("should preserve the method and body of a POST", async () => {
    const request = new Request("https://accountant24.ai/_mintlify/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: 1 }),
    });
    const proxied = toMintlifyRequest(request, target);
    expect(proxied.method).toBe("POST");
    expect(proxied.headers.get("Content-Type")).toBe("application/json");
    expect(await proxied.text()).toBe('{"q":1}');
  });

  it("should send no body for GET and HEAD", async () => {
    expect(toMintlifyRequest(new Request("https://accountant24.ai/docs"), target).body).toBeNull();
    expect(toMintlifyRequest(new Request("https://accountant24.ai/docs", { method: "HEAD" }), target).body).toBeNull();
  });

  it("should let redirects pass through to the browser instead of following them", () => {
    expect(toMintlifyRequest(new Request("https://accountant24.ai/docs"), target).redirect).toBe("manual");
  });

  it("should not modify the original request", () => {
    const request = new Request("https://accountant24.ai/docs");
    toMintlifyRequest(request, target);
    expect(request.url).toBe("https://accountant24.ai/docs");
    expect(request.headers.has("X-Forwarded-Host")).toBe(false);
  });
});
