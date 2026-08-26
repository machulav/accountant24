---
name: a24-writing-guidelines
description: Review docs and prose (docs/**/*.mdx, README) for writing-style compliance. Use when asked to review writing, check docs style, or as the final pass after editing docs pages.
---

<!-- Adapted from https://github.com/vercel-labs/writing-guidelines (command.md, MIT):
     Vercel-specific rules (their platform frontmatter, dashboard links, team
     process) are removed or generalized. To update, re-download that file and
     re-apply this note's adaptations. -->

# Writing Guidelines

Review these files for compliance: $ARGUMENTS

Read files, check against rules below. Output concise but comprehensive: sacrifice grammar for brevity. High signal-to-noise.

## Rules

### Planning & content type

- Know the page's content type: tutorial, how-to, reference, conceptual, troubleshooting, or landing
- Title is user-shaped (the user's question), not feature-shaped (the engineer's name)
- Page does one job: tutorial OR how-to OR reference, not three at once
- Goal is verb-driven (Bloom's taxonomy): "configure", "explain", "debug" (testable)
- Multi-audience pages: short shared opener, then technical subsections

### Voice & tone

- Active voice. Mental test: append "by monkeys". If the sentence parses, rewrite
- Direct address: `you`, never `the user` or `one can`
- Imperative for steps: "Click **Add Project**", not "You will need to click **Add Project**"
- Sentences under 20 words target
- Contractions encouraged (`you'll`, `it's`) for warmth
- Present tense unless describing future behavior
- Limit `we`: only for deliberate product-team actions ("we recommend", "we deprecated"), never as a stand-in for "you"
- No rhetorical questions (sounds like marketing)
- Second-read test: read each sentence once at speech pace; if you re-read to parse it, name the subject, the action, and the consequence (kill metaphor verbs and pronouns reaching back several sentences)

### Banned words

- `easy`, `simple`, `quick`: puts pressure on the reader and reads as marketing; replace with concrete description ("one command", "default settings", "most projects don't need this")
- `very`, `just`, `really`: filler; cut or rewrite

### Concision

- Earn every detail: cut a number, name, or implementation detail if a more general phrasing wouldn't change the reader's understanding or action
- Weasel words: replace vague qualifiers (`significantly`, `many`, `often`, `typically`, `generally`) with a specific number or claim
- Vague quantifiers: no `near-zero`, `sub-second`, `most requests`; give the figure and cite it
- Filler/metaphor verbs: name the action instead of reaching for cadence (`moves through`, `lands`, `carries`, `hits` → the literal step)

### AI-generated tells (flag these)

- Summary-style transitions: never open a paragraph by recapping the last one (`With this setup complete…`, `Now that we've explored…`); pivot straight to the next point (`In practice…`, `The catch is…`)
- Stop-start sentences: don't split one dependent idea into choppy fragments (`Previously this was manual. Now it's automatic. This saves time.` → one sentence); short sentences for emphasis are fine
- Spec-sheet voice: rewrite sentences that read like a system reading a datasheet (`provides`, `is configurable`, `is explicitly labeled`)
- Cold-open paragraphs: a body paragraph whose first sentence works as a standalone heading has no antecedent; carry the prior subject forward (`Because…`, `Once…`)
- Personified artifacts: machines don't perform human-physical actions (`hand the browser a URL` → `the browser fetches the URL`; `the token holds…` → `the token is stored…`)
- Reused framing: the angle must come from this page, not a template (`The question most teams face is whether…`)

### Tone, by content type

- **Tutorial**: warm, encouraging, predictable structure, no traps
- **How-to**: terse, direct (reader is mid-task)
- **Reference**: neutral, exhaustive, quotable
- **Conceptual**: explain like the reader will teach it back; examples and analogies welcome
- **Troubleshooting**: empathetic but not apologetic; acknowledge then fix

### Headings

- Sentence case for page headings (`H1` `H2` `H3`): "Configure environment variables", not "Configure Environment Variables"
- Title case for nav labels: "Configuring Environment Variables"
- The frontmatter `title` becomes the `H1`; `sidebarTitle` becomes the sidebar entry
- Subheadings descriptive, not cute: "Caveats when self-hosting on Cloudflare", not "Caveats"
- Reader should be able to guess section content from the heading alone

### Structure

- Every page opens with a one-paragraph TL;DR of what the page covers
- Every major section opens with a summary sentence
- Acronyms spelled out on first use: "Content Security Policy (CSP) blocks inline scripts"
- Define every term the first time you use it (link to its conceptual page)
- Reference docs organized by surface; education docs organized by reader task
- Keep paragraphs to 2 to 4 sentences; split anything longer or covering two ideas

### Lists

- Three or more list-shaped items in a paragraph: convert to a list
- Bulleted for unordered; numbered for ordered (lifecycles, sequential steps)
- Always introduce a list with a colon
- No periods at the end of list items unless they are full sentences
- Bold/description format: `- **Term**: description here` (colon after bold term)

### Code

- Code blocks need a language tag for syntax highlighting
- TypeScript is the default for new code unless the surface is genuinely language-agnostic
- Multi-step flows wrapped in `<Steps/>` so structure is visible
- Highlight load-bearing lines: `` ```typescript {8-12,23-37} ``
- ≤80 columns per line in snippets
- ≤25 lines per snippet; split longer blocks with prose
- Omit defaults; don't repeat variable definitions, use shared var
- Minimal comments in code blocks; prefer prose explanation
- Explain what every code block does in prose (don't drop and run)
- Don't reference full example files at the end of guides ("See `train.py`"); the guide is the deliverable

### Placeholders

- Text placeholders: `snake_case`, descriptive: `your_access_token_here` (so reader can double-click to select before pasting)
- Number placeholders: count up `1234567890123` (recognizable as fake, predictable)
- Never `<TOKEN>`, `xxx`, `your-token`, or generic ALL_CAPS

### Data sizes & units

- Space + uppercase unit: `64 KB`, `5 KB`, `200 ms`
- Exception: seconds is bare: `30s`
- Consistent across the corpus so readers can develop scanning habits

### Money & pricing pages

- Uncompromising detail: err on "too much"
- Use tables for pricing
- Never assume reader knows the pricing model or whether their workload counts as one invocation or several
- Clarity and transparency above all else

### Emphasis

- **Bold** means UI element or critical fact, never emphasis-for-emphasis-sake
- Reaching for bold for tone: the sentence is weak; rewrite it
- `Inline code` for paths, file extensions, identifiers, short snippets: `/api`, `.tsx`, `body`, `query`, `req`
- Rule: if it would look weird without a monospace font, monospace it

### Punctuation & typography

- Never em dashes (`—`) or dashes (`-`) as punctuation; use colons, commas, periods, or rephrase
- Curly quotes `"` `"` and `'` `'`, not straight `"` or `'`
- Ellipsis `…`, not three dots `...`
- Loading states end with `…`: `Loading…`, `Saving…`
- Non-breaking spaces in `10&nbsp;MB`, `⌘&nbsp;K`, brand names
- `&` over "and" only where space-constrained (nav labels, buttons)

### Source formatting

- Don't hard-wrap paragraphs: each paragraph is one line in source, let the editor wrap
- One blank line before headings; one blank line before and after code blocks
- No `---` horizontal rules between sections
- No extra blank lines between elements that aren't paragraph breaks

### Links

- Define every term the first time it appears, link to its conceptual page
- Anchor text names the destination; never bare URLs or `here`/`link`

### Models in examples

- Name current models in examples, never outdated ones

### Quality checklist (required boxes are non-negotiable)

- **Findability**: page listed in the sidebar navigation; the app links to docs where it exposes the feature
- **Accuracy**: code samples actually run; screenshots map 1:1 to the current UI and show demo data, never real data
- **Relevance**: code samples included where applicable (TypeScript first; `<Steps/>` for multi-step flows)
- **Clarity**: overview addresses who/what/where/why; high-level use cases laid out; prerequisites listed on tutorials; steps detailed not vague; simplest path recommended when multiple exist
- **Completeness**: limits documented; limit tables updated
- **Readability**: nav names scannable and use action verbs; content types accurately used; subheadings descriptive; topics start with summaries; code blocks formatted correctly; active voice where warranted

### Anti-patterns (flag these)

- Em dashes (`—`) or dashes (`-`) used as punctuation
- `easy`, `simple`, `quick` describing reader actions
- Passive voice (apply "by monkeys" test)
- Title Case in page headings (only sentence case in `H1` through `H6`)
- Generic placeholders: `<TOKEN>`, `xxx`, `your-token`, `ABC123`
- Code blocks without a language tag
- JS examples where TypeScript is the convention
- Code blocks over 25 lines without prose between
- Hard-wrapped prose paragraphs (multiple lines for one paragraph in source)
- `---` horizontal rules between sections
- Subheadings that are single generic words: `Overview`, `Caveats`, `Notes`
- Bold used for emphasis instead of UI element or critical fact
- Page or section without an opening summary
- Straight quotes (`"`, `'`) instead of curly (`"`, `'`)
- Three dots (`...`) instead of ellipsis (`…`)
- Acronyms used before being spelled out
- Bare unit numbers (`64KB`, `5kb`, `200MS`) instead of `64 KB`, `5 KB`, `200 ms`
- "We" standing in for "you"
- Rhetorical questions
- Filler words: `very`, `just`, `really`, `simply`
- References to "the full example file at the end of the guide" rather than inlining the code
- Outdated model names in examples
- Hardcoded date/number formats instead of `Intl.DateTimeFormat` / `Intl.NumberFormat` in code samples
- "Loading..." instead of "Loading…"
- Summary-style transitions recapping the previous paragraph (`With this setup complete…`)
- Stop-start fragments splitting one dependent idea into choppy sentences
- Spec-sheet voice reading like a datasheet (`provides`, `is configurable`, `is explicitly labeled`)
- Cold-open body paragraphs whose first sentence has no antecedent
- Personified artifacts performing human-physical actions (`hand the browser a URL`)
- Reused/template framing not specific to the page (`The question most teams face is whether…`)
- Weasel words instead of a specific claim (`significantly`, `many`, `often`, `typically`, `generally`)
- Vague quantifiers without a cited figure (`near-zero`, `sub-second`, `most requests`)
- Filler/metaphor verbs instead of the literal step (`moves through`, `lands`, `carries`, `hits`)
- Sentences that need a second read to parse
- Paragraphs over 4 sentences or covering two ideas
- Bare URLs or `here`/`link` as anchor text

## Output Format

Group by file. Use `file:line` format (VS Code clickable). Terse findings.

```text
## docs/docs/plugins.mdx

docs/docs/plugins.mdx:24 - passive voice ("the plugin is created...")
docs/docs/plugins.mdx:31 - banned word "easy"
docs/docs/plugins.mdx:47 - "..." → "…"
docs/docs/plugins.mdx:58 - code block missing language tag
docs/docs/plugins.mdx:102 - H2 "Caveats" too generic; add specificity
docs/docs/plugins.mdx:118 - em dash in prose, replace with colon/comma

## docs/docs/marketplace.mdx

✓ pass
```

State issue + location. Skip explanation unless fix is non-obvious. No preamble.
