---
description: "Make brain forget a lesson (L<n>), which is no longer loaded and never learned again, or a brain skill (S<n>), which is removed."
---

Run this one command with the Bash tool, with the lesson ID from `$ARGUMENTS` (such as `L12`) in place of `L<n>`. If the user gave none, ask which lesson, and list the candidates with the `brain` skill:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" forget L<n>
```

For a skill ID (`S<n>`), run this instead:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/skills.mjs" forget S<n>
```

Report its one line of output as printed.
