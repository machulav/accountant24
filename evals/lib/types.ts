import { z } from "zod";

// ── Setup schemas ────────────────────────────────────────────────────

const MemorySetupSchema = z.string();

const LedgerSetupSchema = z.object({
  accounts: z.array(z.string()).default([]),
  transactions: z.array(z.array(z.string())).default([]),
});

const SetupSchema = z
  .object({
    memory: MemorySetupSchema.optional(),
    ledger: LedgerSetupSchema.optional(),
  })
  .optional();

// ── Outcome assertion schemas ────────────────────────────────────────

const LedgerAssertionSchema = z.object({
  payee: z.string(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  account: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
});

export type LedgerAssertion = z.infer<typeof LedgerAssertionSchema>;

// ── Eval case schema ─────────────────────────────────────────────────

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const ExpectedSchema = z.object({
  tools_called: z.array(z.string()).optional(),
  tools_not_called: z.array(z.string()).optional(),
  output_contains: z.array(z.string()).optional(),
  output_not_contains: z.array(z.string()).optional(),
  rubric: z.string().optional(),
  ledger_contains: z.array(LedgerAssertionSchema).optional(),
  ledger_not_contains: z.array(LedgerAssertionSchema).optional(),
  memory_contains: z.array(z.string()).optional(),
});

const MetadataSchema = z.object({
  category: z.string(),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(["easy", "medium", "hard"]).default("easy"),
  source: z.string().optional(),
});

export const EvalCaseSchema = z.object({
  id: z.string(),
  input: z.object({
    messages: z.array(MessageSchema).min(1),
  }),
  expected: ExpectedSchema,
  grading: z.enum(["deterministic", "rubric"]),
  metadata: MetadataSchema,
  setup: SetupSchema,
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export type LoadedEvalCase = EvalCase & { sourceFile: string };

// ── Tool call record ─────────────────────────────────────────────────

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result: unknown;
  isError: boolean;
}

// ── Check result ─────────────────────────────────────────────────────

export interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

// ── Eval result ──────────────────────────────────────────────────────

export interface EvalResult {
  id: string;
  passed: boolean;
  checks: CheckResult[];
  toolsCalled: ToolCallRecord[];
  agentOutput: string;
  durationMs: number;
  error?: string;
  sourceFile?: string;
}
