// Bundle entrypoint for the externally-loaded pi extension.
//
// `scripts/bundle-extension.ts` bundles this into a single self-contained
// `accountant24-extension.js` (externalizing pi's virtual modules), which the
// desktop app loads via `pi -e <path>`.
// pi's extension loader calls the default export as `factory(api)`.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// Importing config first resolves ACCOUNTANT24_HOME from the env at module-eval time.
import "./config";
import { createAccountantExtension } from "./extension";

export default function (pi: ExtensionAPI): void {
  createAccountantExtension(pi);
}
