import { main } from "./lib/cli.js";

export function parseModelArg(arg: string): { provider: string; model: string } {
  const slashIndex = arg.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid model format: "${arg}". Expected "provider/model" (e.g. "anthropic/claude-sonnet-4-6")`);
  }
  return { provider: arg.slice(0, slashIndex), model: arg.slice(slashIndex + 1) };
}

// CLI args: skip "bun" and script path
const args = process.argv.slice(2);
const filter = process.env.EVAL_FILTER;

const models =
  args.length > 0
    ? args.map(parseModelArg)
    : [
        {
          provider: process.env.EVAL_PROVIDER ?? "anthropic",
          model: process.env.EVAL_MODEL ?? "claude-sonnet-4-6",
        },
      ];

const judgeProvider = process.env.EVAL_JUDGE_PROVIDER ?? models[0].provider;
const judgeModel = process.env.EVAL_JUDGE_MODEL ?? models[0].model;

let anyFailed = false;

for (const { provider, model } of models) {
  const { exitCode } = await main({ provider, model, judgeProvider, judgeModel, filter });
  if (exitCode !== 0) {
    anyFailed = true;
  }
}

if (anyFailed) {
  process.exit(1);
}
