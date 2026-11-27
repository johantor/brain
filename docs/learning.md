# How brain learns

Learning is on from install. The first session says so once; `/brain:learn off` stops it, and
`/brain:learn on` turns it back on. Off stops reflection and loading; the records continue.

## Reflection

brain watches for friction that you caused: a denied permission, a prompt that pushes back
("no, …", "wrong", "undo"), or any prompt after you pressed Esc to stop a turn. At the first turn after it that ends clean, the Stop hook asks Claude
to reflect. The `reflect` skill then does one of two things:

- If a lesson already loaded covers the mistake, it records a **repeat** of that lesson.
- Otherwise it drafts at most two lessons from your own words, never from tool output, and hands
  them to `brain propose`, which scrubs them, checks them and stores them.

A failed call alone starts no reflection: with none of your words to learn from, it would only
spend tokens. A reflection costs tokens in the session that runs it, at most 3 per session;
`/brain:report` shows the average cost. A session that ended with friction and no reflection is
queued, and a later clean session of the same project reflects on it.

## Loading

From the next session on, each session and each subagent starts with the project's lessons, then
the global ones, pinned first, then newest first, up to about 1,000 tokens. They are background:
your `CLAUDE.md` and your messages win. Claude cites a lesson's ID, such as (L12), when one
changes what it does.

`~/.claude/brain/learned.md` lists the global lessons; the `brain` skill lists all of them. A
session starts with one line that lists what changed since the last one, and every change is also
in `~/.claude/brain/changes.log`.

## Reviewing lessons

`/brain:lessons` lists each live lesson with two signals:

- **Cited**: how often a session or a subagent cited it, read from the transcripts, including the
  subagents' you never see. Subagent citations are split by agent, such as `crew:frontend 2`.
- **Repeated**: how often a reflection found its mistake again despite it.

It suggests Pin for a lesson cited twice and never repeated, and Forget for one repeated as often
as it is cited, then asks you about each one. Pin keeps a lesson and loads it first. Forget stops
it for good: brain never learns it again. `/brain:undo` reverses the latest change.

It suggests Promote for a pinned global lesson that one plugin's agents, such as `crew:*`, cite
more than all others together, in two or more projects: the cause is in the plugin, not in your
project. Promote drafts an issue with the lesson, the citing agents and the counts, and no project
name, path or session text; a draft whose lesson names a citing project is refused. Only a plugin on
brain's `promote` list gets Promote: by default `board@johantor`, `crew@johantor` and
`personas@johantor`, matched by name and marketplace. `/brain:promote` lists it and changes it. The target
repository is the `repository` in the installed plugin's own manifest. brain sends nothing: you
see the whole draft, then pick Send (one `gh issue create`), Copy or Skip. A sent lesson is not
suggested again; forget it once the plugin ships the fix.

brain retires a lesson on its own only when it is a project lesson whose project has had no
session for 90 days. A pinned lesson is never retired.

## brain skills

When three lessons name the same tool, brain asks Claude at a clean stop to merge them into one
skill, at most once a week per tool. The draft waits 3 days, then goes live as
`~/.claude/skills/brain-<name>/`, unless you forget one of its lessons first. `/brain:forget S<n>`
stops it at any time. A brain skill nobody calls for 30 days is removed. There are at most 5, and
brain never changes a skill it did not write.

## Your global CLAUDE.md

Ask "what should go in my global CLAUDE.md?" and brain lists the auto-memory entries that Claude
Code keeps in two or more of your projects. It suggests them; it never edits `CLAUDE.md` or auto
memory.
