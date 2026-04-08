# Accountant24

Your personal AI accountant. Talk to it about your money — it handles the bookkeeping, answers questions, and notices things you'd miss. Your data stays as plain text files on your machine. Works with any LLM — including local ones.

## Why I built this

I used YNAB for years to manage my personal finances. It worked, but managing transactions manually was time-consuming, and it wasn't flexible enough.

So I started experimenting with hledger inside OpenClaw — built a few skills and tools to talk to it through the agent. It worked, but the setup quickly got chaotic, and OpenClaw felt like overkill for something this focused.

That's when I decided to pack everything into a standalone, local-first agent: Accountant24.

I now use it daily — and I'm honestly surprised how enjoyable managing a personal finances can be with a specialized agent.

## Principles

**Your finances are yours.** Plain text files on your device. No cloud, no proprietary format, no lock-in. Even the LLM can run locally on your machine — your financial information never has to leave your device.

**Bookkeeping done right.** Double-entry bookkeeping — the gold standard used by accountants for centuries. Not a simplified budget tracker. Real accounting.

**An AI accountant that learns.** Remembers what matters and learns as you go.

## What you can do

### Log spending in natural language

> "I spent $45 at Whole Foods yesterday"

The agent figures out the details and creates a properly formatted double-entry transaction.

### Ask questions about your money

> "How much did I spend on food this month?"

> "What's my net worth?"

> "Show me all transactions from my last trip to Italy"

The agent queries your ledger and gives you a formatted answer.

### Set rules and facts

> "Remember that my salary is $5,000/month and arrives on the 15th"

> "My food budget is $600/month"

Tell the agent your preferences, recurring expenses, categorization rules, and financial goals. It remembers across sessions and uses this context to make better decisions.

### Shortcuts

Type `@` to search and insert accounts, payees, or tags inline. Use `/accounts`, `/payees`, `/tags`, `/memory`, and other slash commands for quick actions.

### Git-versioned finances

Every change is auto-committed to a local git repo. Your financial history gets the same version control as your code. Push to a private repo for backup.

## How it compares

|  | Accountant24 | YNAB / Monarch | Actual Budget | hledger CLI |
|---|---|---|---|---|
| Data format | Plain text (hledger) | Proprietary cloud | SQLite | Plain text (hledger) |
| Data location | Your machine | Their servers | Your machine | Your machine |
| Input method | Natural language | Manual entry | Manual entry | Manual entry |
| AI | Built-in, learns over time | — | — | — |
| Memory | Persistent | — | — | — |
| Accounting | Double-entry bookkeeping | Envelope budgeting | Envelope budgeting | Double-entry bookkeeping |
| Price | Free | $110–180/yr | Free | Free |
| Lock-in | None (plain text) | High | Medium | None (plain text) |

## Quick start

### Prerequisites

Install [hledger](https://hledger.org/install.html) — the accounting engine.

### Install

```bash
npm install -g accountant24
```

### Run

```bash
a24
```

On first launch, Accountant24 creates `~/.accountant24/` workspace with a pre-configured set of accounts, initializes a git repo, and you're ready to go.

### Log in & pick a model

Use `/login` to log in with your LLM provider subscription, then `/model` to pick a model — and you're ready to start chatting.

### Go fully local (optional)

Want your financial data to never leave your machine? Run a local model with [Ollama](https://ollama.com). Gemma 4 models are pre-configured in Accountant24 and appear in the `/model` selector.

1. [Download and install Ollama](https://ollama.com/download).
2. Pull a Gemma 4 model:

   ```bash
   ollama pull gemma4:26b  # ~16 GB RAM
   # or
   ollama pull gemma4:31b  # ~24 GB+ RAM
   ```

3. Use `/model` to select the Gemma 4 model — and start chatting. Nothing leaves your device.

## Why hledger + LLM + pi

[hledger](https://hledger.org) is a powerful accounting engine with proper double-entry bookkeeping. It's actively developed — [v2 is currently in preview](https://github.com/simonmichael/hledger/releases/tag/1.99.1), introducing automated lot tracking and capital gains calculation for investment accounts. But hledger has a learning curve: journal syntax, report commands, filter expressions.

LLMs are great at understanding natural language. But they hallucinate numbers and can't do accounting on their own.

[pi](https://github.com/badlogic/pi-mono) by [Mario Zechner](https://github.com/badlogic) is the agent framework that ties everything together — handling session management, tool execution, and LLM communication.

Put together, they're a perfect match. You speak naturally. The agent translates your words into proper accounting entries. hledger ensures everything balances. You get the rigor of real accounting without the friction.

Add persistent memory and custom skills on top — and the agent turns into something more than a bookkeeper. It can help with tax filing, financial planning, automated bank import, and whatever else you teach it. It's a foundation you can build on.

## Credits

Accountant24 wouldn't exist without these projects:

- **[pi](https://github.com/badlogic/pi-mono)** by [Mario Zechner](https://github.com/badlogic) — a minimal, elegant framework for building AI agents.
- **[hledger](https://hledger.org)** by [Simon Michael](https://github.com/simonmichael) — the accounting engine that makes proper double-entry bookkeeping possible.

Both are remarkable pieces of software.

## Contributing

Contributions are welcome! Open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
