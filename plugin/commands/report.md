---
description: "Show what brain recorded: sessions, prompts, failures, denials, interrupts and tokens per project."
---

Run this one command with the Bash tool, exactly as written. Pass `$ARGUMENTS` through after it
only when the user gave `--days <n>`:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/report.mjs"
```

Show its output as printed, in a code block. Do not interpret or summarize it.

If it fails:

- `node: command not found`, or an error about `node:sqlite`: brain needs Node.js 22.13 or
  later. Say so and stop.
- Anything else: show the error as printed and stop. Do not retry.
