---
description: "Review brain's lessons with their evidence, and keep, pin, forget or promote each one."
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

## Promote

A lesson can suggest Promote: it is pinned, and mostly one plugin's agents cite it, in two or more
projects, so the fix belongs in that plugin. Only a plugin that opts in gets it. Offer Promote as a fourth option only for that
lesson, and only through AskUserQuestion: without it, as in a headless run, do not offer it and
draft nothing. When the user picks Promote, run:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" draft L<n>
```

It prints the target `repository:`, the `title:` and the issue body. If it prints "no draft",
report it and stop. Ask once more with AskUserQuestion. The question holds the whole draft,
unchanged. The options are Send, Copy and Skip. Do
not send anything unless the user picks Send. For Send, run this one command, with the
repository and title as printed. It sends nothing when the draft is refused now:

```bash
body=$(node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" draft L<n> --body) && printf '%s\n' "$body" | gh issue create --repo <owner/repo> --title "<title>" --body-file -
```

Then record the issue URL that `gh` printed:

```bash
node --disable-warning=ExperimentalWarning "${CLAUDE_PLUGIN_ROOT}/lib/manage.mjs" promoted L<n> <issue url>
```

For Copy, show the draft in a code block for the user to file by hand. After the plugin ships the
fix, the user forgets the lesson with `/brain:forget L<n>`.
