// Entry point for the `accountant24-auth` helper binary.
//
// Compiled standalone via `bun build --compile` and bundled into the desktop app.
// The app spawns it as `accountant24-auth <subcommand> [flags]`; argv[2..] is the
// subcommand and its flags (slice(2): a compiled bun binary has two leading argv
// entries before user args).
import { runAuthCli } from "./auth";

runAuthCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stdout.write(`${JSON.stringify({ type: "error", message: String(error) })}\n`);
    process.exit(1);
  },
);
