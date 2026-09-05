// Which request paths belong to the docs (Mintlify, hosted at the /docs
// subpath) and must be proxied instead of served from the static site.
// Mirrors `assets.run_worker_first` in wrangler.jsonc and Mintlify's
// Cloudflare recipe: the docs subpath, its asset bundle, the API playground,
// and the well-known paths Mintlify/Vercel use for domain verification.

const PROXIED_PREFIXES = ["/docs/", "/mintlify-assets/", "/_mintlify/", "/.well-known/"];

/** True when `pathname` must be proxied to Mintlify. */
export function isDocsPath(pathname: string): boolean {
  if (pathname === "/docs") return true;
  return PROXIED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
