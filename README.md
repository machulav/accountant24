# Accountant24

Your personal AI accountant. A command-line personal finance assistant powered by any LLM.

## Quick Start

```bash
cp .env.example .env
bun install
bun start
```

## Project Structure

```
accountant24/
├── src/
│   ├── index.ts                     # Entry point → runs CLI
│   ├── core/                        # Agent brain — zero UI dependencies
│   │   ├── index.ts                 # Public API: createAgent()
│   │   ├── config.ts                # Default LLM provider & model
│   │   └── agent/
│   │       ├── agent.ts             # Agent factory (pi-agent-core)
│   │       └── system-prompt.ts     # Accountant24 system prompt
│   └── cli/                         # Terminal frontend
│       ├── index.ts                 # Creates agent, launches TUI
│       └── tui/
│           ├── app.ts               # TUI lifecycle, layout, input handling
│           ├── chat.ts              # Agent events → TUI streaming bridge
│           └── theme.ts             # Chalk-based color theme
├── .env.example                     # Required env vars template
├── .gitignore
├── package.json
└── tsconfig.json
```

### Layer Rules

- **`core/`** has zero dependencies on `cli/`. It is the agent brain.
- **`cli/`** depends on `core/`. It is the TUI — one of many possible frontends.

## Tech Stack

| Concern  | Choice                        |
| -------- | ----------------------------- |
| Runtime  | Bun + TypeScript              |
| Agent    | `@mariozechner/pi-agent-core` |
| LLM API  | `@mariozechner/pi-ai`         |
| Chat TUI | `@mariozechner/pi-tui`        |

## Evals

Run the eval suite against one or more models:

```bash
# Default model (anthropic/claude-sonnet-4-6)
bun eval

# Specific model
bun eval anthropic/claude-sonnet-4-6

# Multiple models (runs full suite for each)
bun eval anthropic/claude-sonnet-4-6 openai/gpt-5

# Filter to specific cases
EVAL_FILTER=tool-selection bun eval
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `EVAL_PROVIDER` | `anthropic` | Default provider (used when no CLI args) |
| `EVAL_MODEL` | `claude-sonnet-4-6` | Default model (used when no CLI args) |
| `EVAL_JUDGE_PROVIDER` | same as provider | Provider for rubric grading |
| `EVAL_JUDGE_MODEL` | same as model | Model for rubric grading |
| `EVAL_FILTER` | _(none)_ | Filter cases by ID substring |

## Controls

- **Ctrl+C** — exit
- **`/exit`** — exit
- **Escape** — cancel in-flight response
- **Arrow up/down** — input history
- **Tab** — autocomplete slash commands
