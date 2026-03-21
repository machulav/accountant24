---
name: a24:add-eval
description: Interactively add a new eval case to evals/cases.jsonl. Interviews the user to collect all fields, then appends a valid JSONL line.
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Add Eval Case

Add a new evaluation case to `evals/cases.jsonl` by interviewing the user.

## Eval Case Schema

Each case is a single JSON line with these fields:

```jsonc
{
  "id": "category-slug-NNN",       // auto-generated
  "input": {
    "messages": [{"role": "user", "content": "..."}]
  },
  "expected": {
    "tools_called": [],             // optional: which tools SHOULD be called
    "tools_not_called": [],         // optional: which tools MUST NOT be called
    "output_contains": [],          // optional: substrings the output must contain
    "output_not_contains": [],      // optional: substrings the output must NOT contain
    "rubric": ""                    // optional: human-readable grading criteria
  },
  "grading": "rubric",             // "rubric" | "contains" | "deterministic"
  "metadata": {
    "category": "",                 // tool_selection | tool_params | multi_step | error_handling | reasoning | refusal
    "tags": [],
    "difficulty": "",               // trivial | easy | medium | hard
    "source": ""                    // manual | real_conversation | bug_report
  }
}
```

## Available Tools in Beanclaw

The agent has these tools: `query`, `add_transaction`, `validate`, `read`, `write`, `edit`, `bash`, `update_memory`.

## Interview Process

Collect information step by step. Be efficient - combine questions when possible, skip optional fields the user doesn't care about, and infer what you can from context.

### Step 1: Get the user prompt

Ask: **What's the user prompt for this eval case?**

If the user already provided it (e.g., as an argument to `/add-eval`), skip this question.

### Step 2: Determine category and expected behavior

Based on the prompt, suggest a category and ask the user to confirm or override:

- **tool_selection** — testing that the agent picks the right tool
- **tool_params** — testing that tool parameters are correct
- **multi_step** — testing chained tool workflows
- **error_handling** — testing graceful failure and edge cases
- **reasoning** — testing intent understanding and query formulation
- **refusal** — testing that the agent refuses dangerous/inappropriate requests

Then ask in one combined question:
- Which tools should be called? (suggest based on the prompt)
- Which tools must NOT be called? (if relevant)
- What makes a correct response? (this becomes the rubric)
- Other relevant information, if any.

### Step 3: Fill in metadata

Ask (or infer):
- **Difficulty**: trivial / easy / medium / hard
- **Source**: manual / real_conversation / bug_report
- **Tags**: suggest relevant tags, ask user to confirm

### Step 4: Generate and append

1. Auto-generate the `id` from category + slug of the prompt (e.g., `tool-selection-checking-balance-001`). If a case with that id already exists, increment the number.
2. Choose `grading` strategy:
   - Use `"deterministic"` if the case only checks `tools_called`, `tools_not_called`, `output_contains`, `output_not_contains` (no rubric needed)
   - Use `"rubric"` if there's a rubric field
   - Use `"contains"` if only checking output substrings
3. Only include `expected` fields that have values (omit empty arrays and empty strings)
4. Format as compact single-line JSON (no pretty-printing)
5. Read the existing `evals/cases.jsonl` to check for duplicate IDs
6. Append the new line to `evals/cases.jsonl` using Bash: `echo '...' >> evals/cases.jsonl`
7. Show the user the final case for confirmation before appending

## Principles

- **Grade outcomes, not trajectories**: Focus on whether the result is correct, not the exact sequence of tool calls
- **Be specific in rubrics**: Vague rubrics like "agent responds correctly" are useless. Say what "correct" means.
- **Include negative constraints**: Test what should NOT happen, not just what should
- **One case, one thing**: Each case should test one specific behavior. Don't overload a single case.

## Notes

- When showing the final case for confirmation, show it in a readable, formatted JSON format to the user.