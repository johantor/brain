---
description: "Turn brain's learning on or off, or show whether it is on. On (the default), brain drafts lessons after a correction or a denied permission and loads them at session start."
---

Run this one command with the Bash tool. Add `on` or `off` after it only when the user gave one
in `$ARGUMENTS`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/config.mjs" learn
```

Report its one line of output as printed. When it turned learning off, add one sentence: brain
still records the sessions for `/brain:report` and the `brain` skill, and drafts and loads
nothing until `/brain:learn on`.
