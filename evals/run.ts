import { main } from "./lib/cli.js";

const provider = process.env.EVAL_PROVIDER ?? "anthropic";
const model = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";
const judgeProvider = process.env.EVAL_JUDGE_PROVIDER ?? provider;
const judgeModel = process.env.EVAL_JUDGE_MODEL ?? model;
const filter = process.env.EVAL_FILTER;

const { exitCode } = await main({ provider, model, judgeProvider, judgeModel, filter });
if (exitCode !== 0) {
  process.exit(exitCode);
}
