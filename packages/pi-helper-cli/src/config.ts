import { homedir } from "node:os";
import { join } from "node:path";

// The workspace dir where auth.json + models.json live. Same contract as the
// pi-extension: the desktop app sets ACCOUNTANT24_HOME in the sidecar env (=
// PI_CODING_AGENT_DIR), so what this helper writes is what the agent reads;
// falls back to ~/Accountant24 when run standalone.
const envHome = process.env.ACCOUNTANT24_HOME;
export const ACCOUNTANT24_HOME = envHome && envHome.length > 0 ? envHome : join(homedir(), "Accountant24");
