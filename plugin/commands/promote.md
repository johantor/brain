---
description: "Allow or stop Promote for a plugin, or list the plugins it is allowed for. Promote drafts an issue for a plugin's repository from a lesson its agents keep citing."
---

Run this one command with the Bash tool. Add `<plugin>@<marketplace> on` or `off` after it only
when the user gave one in `$ARGUMENTS`, such as `crew@johantor off`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/config.mjs" promote
```

Report its one line of output as printed. When it allowed a plugin, add one sentence:
`/brain:lessons` can now suggest Promote for that plugin's lessons, and sends an issue only when
the user picks Send on the full draft.
