---
name: a24-docs-writing
description: House rules for writing and editing the docs site (docs/**/*.mdx), distilled from review feedback. Use when adding or reworking docs pages, before asking for a review.
---

# Writing docs for Accountant24

Style mechanics (voice, sentence length, banned words, heading case) are the `a24-writing-guidelines` skill's job: run it once the text is ready, and fix what it finds. The rules below are the house rules on top of it.

## Content

- Keep pages brief: just enough to understand the main concepts. Every sentence must earn its place; when a sentence answers a question no reader asked (history, removed features, edge cases), cut it.
- One home per topic. Each fact lives on exactly one page; every other place links to it with "See [X](…) for more details." When content moves, update every reference: other pages, the README, the app, external repos.
- Feature pages target normal users. Technical detail (formats, field limits, file paths, mechanics) lives in the guides, and feature pages link there.
- One-time migration and breaking-change instructions go in the PR description, not in the docs.
- Verify every claim against the code before writing it: names, paths, limits and behavior come from the source, never from memory. Use the platform's official terms (a GitHub "topic", not a "tag" or "label").
- Write so the text stays true as the product grows: no built-in lists, no counts, no topic summaries that drift when the set changes.

## Shape

- The frontmatter `description` renders as the page lead, so it is the opening paragraph. Don't repeat it in the body.
- Tell the reader what to do, in UI terms ("Click **Uninstall**", "Restart the app"). Describe internals only when they answer a trust question: what is downloaded, what runs, what is deleted.
- Sibling sections mirror each other's structure and phrasing (Install and Uninstall both open with one action sentence, then "During the …, the app …").
- Main topics get root-level headings; group sections only when the group name adds meaning. Every heading is self-contained: "Publish your own plugin", never "Publish your own".
- Link text names its destination. Never hang a link on another concept's words.
- Separate clauses with periods, never with colons or semicolons. A colon is fine only to introduce a list, an example, or a code block.

## Process

- Preview with the `a24-docs-preview` skill while editing; changes hot-reload.
- After renaming any heading, re-check internal links and anchors across the repo (and the app, which links into the docs).
- Finish with an `a24-writing-guidelines` review pass.
