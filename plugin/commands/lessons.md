---
description: "Review brain's lessons with their evidence, and keep, pin or forget each one."
---

Run this one command with the Bash tool:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" list
```

Each lesson prints as two lines: its ID, status, scope, age, how often a session or subagent cited
it, how often its mistake happened again, a suggestion, and then its text. If it prints "no live
lessons", say so and stop.

Ask the user about every lesson with the AskUserQuestion tool, at most four lessons per call, one
question per lesson. The question holds the lesson's text and its evidence line. The header is the
lesson ID, such as `L12`. The options are Keep, Pin and Forget: leave out Pin for a lesson that is
already pinned, and put the suggested option first with "(Recommended)" after its label. Write
lesson IDs as `L12`, never in parentheses: brain counts `(L12)` as a citation. Without
AskUserQuestion, show the list and ask the user to reply with the IDs to pin and to forget.

Then run one command for each action that has IDs, with every ID for it:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" pin L<n> L<n>
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" forget L<n> L<n>
```

Report their output as printed. Keep needs no command. `/brain:undo` reverses the latest change.
