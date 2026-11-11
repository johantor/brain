---
name: brain-review
description: Review a PR, branch or working diff in this repo against its own rubric, run the repo's checks, and reproduce each finding before reporting it. Use when asked to review code or a PR in this repo.
---

# brain review

The rubric is `.github/skills/code-review/SKILL.md`. Read it first and apply all of it. This
skill adds only what a session with a shell can do.

1. **Get the diff.** PR number: fetch it through the GitHub MCP tools. Otherwise diff the branch
   against `main`. List every changed file and hunk (rubric, "Scope").
2. **Run every `run:` step in `.github/workflows/validate.yml`**, with the PR's base branch as
   the changelog base (`main` when there is no PR). Name any you cannot run (a missing
   `shellcheck`, or a Node older than 22.13). A red check is Blocking.
3. **Reproduce every finding.** A hook finding: unset `CLAUDE_CODE_REMOTE`, pipe the payload into
   `plugin/hooks/capture.sh` with `CLAUDE_BRAIN_DIR` set to a temp dir, and query the rows it
   wrote. A scan finding: write the transcript lines under a temp `CLAUDE_CONFIG_DIR/projects/`
   and call `scan()` in a `node -e` script. No wrong result, no Blocking finding.
4. **Check new tests pin something**: run the changed suite against the base version of every
   changed file. A new case that still passes is a Warning.
5. **Report** in the rubric's format, most severe first. Post to GitHub only when asked.
