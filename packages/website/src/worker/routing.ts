// Which request paths Mintlify serves (the docs, hosted at the /docs subpath)
// and must be proxied instead of served from the static site. Mirrors
// `assets.run_worker_first` in wrangler.jsonc and Mintlify's Cloudflare
// recipe: the docs subpath, its asset bundle, the API playground, and the
// well-known paths Mintlify/Vercel use for domain verification.
//
// Two of Mintlify's files are also served at the site root: agents look for
// `llms.txt` and `llms-full.txt` there, while Mintlify generates them under
// /docs like every other docs path.

const PROXIED_PREFIXES = ["/docs/", "/mintlify-assets/", "/_mintlify/", "/.well-known/"];

/** Root paths answered by a Mintlify file that lives under /docs. */
const ROOT_ALIASES = new Map([
  ["/llms.txt", "/docs/llms.txt"],
  ["/llms-full.txt", "/docs/llms-full.txt"],
]);

/** The path Mintlify serves `pathname` at, or undefined when the static site handles it. */
export function mintlifyPath(pathname: string): string | undefined {
  if (pathname === "/docs") return pathname;
  if (PROXIED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return pathname;
  return ROOT_ALIASES.get(pathname);
}
