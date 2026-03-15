# BeanClaw

Your personal AI accountant. A command-line personal finance assistant powered by any LLM.

## Quick Start

```bash
cp .env.example .env
bun install
bun start
```

## Project Structure

```
beanclaw/
├── src/
│   ├── index.ts                     # Entry point → runs CLI
│   ├── core/                        # Agent brain — zero UI dependencies
│   │   ├── index.ts                 # Public API: createAgent()
│   │   ├── config.ts                # Default LLM provider & model
│   │   └── agent/
│   │       ├── agent.ts             # Agent factory (pi-agent-core)
│   │       └── system-prompt.ts     # BeanStalk system prompt
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

## Controls

- **Ctrl+C** — exit
- **`/exit`** — exit
- **Escape** — cancel in-flight response
- **Arrow up/down** — input history
- **Tab** — autocomplete slash commands
