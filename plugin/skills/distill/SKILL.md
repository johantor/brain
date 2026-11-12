---
name: distill
description: Drafts one personal skill from a group of brain lessons that name the same tool, and stages it with brain's skills command. Use only when a brain hook message asks for it.
---

# brain: distill

A brain hook listed three or more lessons that name the same tool. A skill costs only its
description until a task needs it, so these lessons may work better as one skill.

1. **Decide whether they belong together.** If they are about different things that happen to
   name one tool, stage nothing and end with "brain: no skill".
2. **Write the skill**:
   - `name`: 3 to 31 lowercase letters, digits or hyphens, after the tool (`rg-search`). brain
     adds the `brain-` prefix.
   - `description`: one line, at most 200 characters, that says when the skill applies. All
     skill descriptions share the context, so be short and specific.
   - `body`: prose, a few short paragraphs: what to do, when, and why, merged from the lessons.
     No frontmatter, no tool settings, no URLs, paths, project names or command lines with
     arguments.
3. **Stage it** with the command the hook message gave, one JSON object on stdin:

   ```bash
   node --disable-warning=ExperimentalWarning "<skills.mjs path>" propose <<'JSON'
   {"tool": "<the tool the hook message named>", "name": "…", "description": "…", "body": "…"}
   JSON
   ```

   It prints `staged S<n>` or `rejected: <reason>`. A rejection is final for this turn.
4. **End the turn** with one short line: what was staged, or "brain: no skill". The skill goes
   live in 3 days unless the user forgets it with `/brain:forget S<n>`.
