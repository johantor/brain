---
description: "Make brain forget a lesson (L<n>): it is no longer loaded and is never learned again."
---

Run this one command with the Bash tool, with the lesson ID from `$ARGUMENTS` (such as `L12`) in place of `L<n>`. If the user gave none, ask which lesson, and list the candidates with the `brain` skill:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" forget L<n>
```

Report its one line of output as printed.
