---
description: "Turn brain's lesson loading on or off, or show whether it is on. When on, each session starts with the lessons for its project and the global ones."
---

Run this one command with the Bash tool. Add `on` or `off` after it only when the user gave one
in `$ARGUMENTS`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/config.mjs" learn
```

Report its one line of output as printed. When it turned loading on, add one sentence: the next
session starts with the lessons, `~/.claude/brain/learned.md` lists the global ones, and the
`brain` skill lists them all.
