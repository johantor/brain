---
description: "Turn brain's shadow reflection on or off, or show whether it is on. It drafts lessons at the end of turns that had friction, and spends that session's tokens."
---

Run this one command with the Bash tool. Add `on` or `off` after it only when the user gave one
in `$ARGUMENTS`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/config.mjs" reflect
```

Report its one line of output as printed. When it turned reflection on, add one sentence: lessons
are stored as drafts, they load into sessions only once `/brain:learn on` is set, and the `brain`
skill lists them.
