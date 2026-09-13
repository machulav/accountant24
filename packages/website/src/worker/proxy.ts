// Builds the upstream request for a docs path, per Mintlify's subpath-hosting
// recipe: same path on the Mintlify host, plus the forwarding headers Mintlify
// uses to render absolute links for the public domain.
//
// The request is rebuilt field by field rather than cloned with
// `new Request(url, request)`: cloning the incoming request hangs the
// outbound fetch in `wrangler dev`, and hop-by-hop headers must not be
// forwarded anyway.

export interface ProxyTarget {
  /** Mintlify project host, e.g. `accountant24.mintlify.site`. */
  mintlifyHost: string;
  /** Public host the visitor used, e.g. `accountant24.ai`. */
  siteHost: string;
}

/** Headers that describe the client connection, not the request; never forwarded. */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
]);

/** Return a new request for `request`'s path addressed to Mintlify, with the forwarding headers set. */
export function toMintlifyRequest(request: Request, target: ProxyTarget): Request {
  const url = new URL(request.url);
  url.protocol = "https:";
  url.hostname = target.mintlifyHost;
  url.port = "";

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
  }
  headers.set("X-Forwarded-Host", target.siteHost);
  headers.set("X-Forwarded-Proto", "https");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    // Pass redirects through to the browser instead of following them here.
    redirect: "manual",
  };
  if (hasBody) {
    init.body = request.body;
    // Required by the Fetch spec when the body is a stream.
    init.duplex = "half";
  }
  return new Request(url, init);
}
