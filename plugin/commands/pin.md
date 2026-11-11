---
description: "Pin a lesson (L<n>): brain keeps it and loads it first."
---

Run this one command with the Bash tool, with the lesson ID from `$ARGUMENTS` (such as `L12`) in place of `L<n>`. If the user gave none, ask which lesson, and list the candidates with the `brain` skill:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" pin L<n>
```

Report its one line of output as printed.
