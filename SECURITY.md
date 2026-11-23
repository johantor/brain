# Security

brain records your prompts, which can hold client code and secrets, so its boundary matters. It
keeps everything on your machine and sends nothing anywhere.

## How brain protects your data

- **Scrubbed before storage.** Secrets (common token formats, private keys, `password=` and
  similar pairs), URLs, e-mail addresses, absolute paths, IP addresses, host names, and the
  project's folder, repo and remote names become placeholders such as `<path>`.
- **No tool output.** Not even an error's text past its exit code, so a fetched page cannot plant
  text that a later reflection reads. A lesson may name a tool and its flags, never a script, a
  URL or a command with arguments.
- **Yours alone.** `~/.claude/brain` is mode 700, and its files 600.
- **Nothing in the cloud.** In a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`), the hooks
  exit at once. The container is thrown away, so its records would be lost anyway.
- **What stays raw:** each session's working directory, so the report can name the project.

The README's *Known gaps* lists what this does not protect against.

## Reporting a vulnerability

Report a way around these protections (raw text or tool output in `brain.db`, a file another user can
read, a hook that blocks or fails a session) privately through
[a security advisory](https://github.com/johantor/brain/security/advisories/new), not in a public
issue.
