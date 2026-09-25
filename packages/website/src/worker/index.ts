// Cloudflare Worker entry: docs paths go to Mintlify, everything else to the
// static site (only docs paths reach the Worker in production, see
// `run_worker_first` in wrangler.jsonc; the fallthrough keeps `wrangler dev`
// and any future pattern change safe).
import { toMintlifyRequest } from "./proxy";
import { mintlifyPath } from "./routing";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  MINTLIFY_HOST: string;
  SITE_HOST: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const upstream = mintlifyPath(new URL(request.url).pathname);
    if (upstream) {
      return fetch(toMintlifyRequest(request, { mintlifyHost: env.MINTLIFY_HOST, siteHost: env.SITE_HOST }, upstream));
    }
    return env.ASSETS.fetch(request);
  },
};
