# Accountant24

Your personal AI accountant. Talk to it about your money — it handles the bookkeeping, answers questions, and notices things you'd miss. Your data stays as plain text files on your machine. Works with any LLM — including local ones.

## Why I built this

For years, I managed my personal finances with YNAB. It worked — but every transaction was a manual chore. I'd fall behind, dread catching up, and put it off for weeks at a time.

One weekend I started playing with hledger and Claude Code, just to see if an agent could handle the bookkeeping for me. I wrote a couple of small skills, and to my surprise, it actually worked — and it was genuinely fun to use.

So I kept going. I packed everything into a standalone agent, tuned it for this one job, and started using it every day. I'm honestly happier with it than any tool I've used for my money before.

If it works this well for me, maybe it'll work for you too. That's why I'm releasing it as an open source project.

## Philosophy

Financial data is some of the most personal stuff you have. It deserves a tool that respects that — one that keeps your data yours, gives you the rigor of real accounting without the pain of learning a domain-specific language, and adapts to your life instead of forcing you into a template. Every other decision in Accountant24 flows from that.

## What you can do

### Log spending in natural language

> I spent $45 at Whole Foods yesterday

The agent figures out the details and adds it to your ledger as a proper double-entry transaction.

### Import from files

> Here is my March bank statement, please add missing transactions: ~/Downloads/statement-march.pdf

> Add transaction from this receipt: ~/Desktop/receipt.jpg

Drop in a PDF bank statement, an invoice, or a photo of a paper receipt. The agent extracts the text, pulls out every transaction, and adds them to your ledger. The original file is archived in your workspace so you can refer back to it later.

### Ask questions about your money

> How much did I spend on food this month?

> What's my net worth?

> Show me all transactions from my last trip to Italy

The agent checks your ledger and gives you a clear answer.

### Set rules and facts

> I'm visiting Italy from April 10th to 15th.
> Tag all transactions during this period with the 'trip_italy' tag.

> My food budget is $600/month

The agent remembers what you tell it and uses it to make better decisions.

### Track every change

Every modification is auto-committed to a local git repo. Review your history anytime, roll back mistakes, or push to a private repo for backup.

## How it compares

|                 | Accountant24               | YNAB / Monarch     | Actual Budget      | hledger CLI              |
| --------------- | -------------------------- | ------------------ | ------------------ | ------------------------ |
| Data format     | Plain text (hledger)       | Proprietary cloud  | SQLite             | Plain text (hledger)     |
| Data location   | Your machine               | Their servers      | Your machine       | Your machine             |
| Input method    | Natural language           | Manual entry       | Manual entry       | Manual entry             |
| AI              | Built-in, learns over time | —                  | —                  | —                        |
| Memory          | Persistent                 | —                  | —                  | —                        |
| Version control | Git, built-in              | —                  | —                  | Via manual setup         |
| Accounting      | Double-entry bookkeeping   | Envelope budgeting | Envelope budgeting | Double-entry bookkeeping |
| Bank sync       | —                          | Yes                | Yes (via add-ons)  | —                        |
| GUI             | Terminal chat              | Web + mobile       | Web + desktop      | CLI                      |
| Price           | Free (+ LLM cost)          | $109/yr            | Free               | Free                     |
| Lock-in         | None (plain text)          | High               | Medium             | None (plain text)        |

## Quick start

### Install

```bash
brew install machulav/tap/accountant24
```

### Run

```bash
a24
```

On first launch, Accountant24 creates a `~/Accountant24/` workspace with a pre-configured set of accounts, initializes a git repo, and you're ready to go.

### Log in & pick a model

Use `/login` to log in with your LLM provider subscription, then `/model` to pick a model — and you're ready to start chatting.

### Go fully local (optional)

Want your financial data to never leave your machine? Run a local model with Ollama. Gemma 4 models are pre-configured in Accountant24 and appear in the `/model` selector.

1. [Download and install Ollama](https://ollama.com/download).
2. Pull a Gemma 4 model:

   ```bash
   ollama pull gemma4:26b  # requires ~16 GB RAM
   # or
   ollama pull gemma4:31b  # requires ~24 GB+ RAM
   ```

3. Use `/model` to select the Gemma 4 model — and start chatting. Nothing leaves your device.

## Why this stack

Each piece of this puzzle does one thing really well.

**hledger** is a mature accounting engine with proper double-entry bookkeeping. It's fast, reliable, and stores everything in plain text files you fully own. The catch: it has a steep learning curve — journal syntax, report commands, filter expressions. Not something most people want to deal with.

**LLMs** are great at understanding what you mean in plain language. But they hallucinate numbers and can't do accounting on their own. Left alone with a ledger, they'd quietly corrupt your books.

**pi** is the agent framework that glues everything together — sessions, tool execution, LLM communication. It's small, well-designed, and easy to extend.

Put them together and each piece covers the other's weakness. You speak naturally, the LLM figures out what you mean, hledger keeps the math honest, pi orchestrates the whole thing. That's the combination I ended up with after trying a few alternatives — and it's been working well ever since.

## Credits

Accountant24 wouldn't exist without these projects:

- **[pi](https://github.com/badlogic/pi-mono)** by [Mario Zechner](https://github.com/badlogic) — a minimal, but powerful framework for building AI agents.
- **[hledger](https://hledger.org)** by [Simon Michael](https://github.com/simonmichael) — the accounting engine that makes proper double-entry bookkeeping possible.

Both are remarkable pieces of software.

## Contributing

This is a personal project I use every day, and I'd love to hear from anyone else using it. Bug reports, ideas, feedback, pull requests — all welcome. If you're planning a bigger change, open an issue first so we can talk it through.

## License

[MIT](LICENSE)
