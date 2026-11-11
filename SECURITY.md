# Security

brain records your prompts, which can hold client code and secrets, so its boundary matters: it
scrubs secrets, URLs, paths, host names and project names before it stores a prompt, it never
stores tool output, and its directory and database are readable by you alone. The README's
*Privacy* and *Known gaps* sections describe what it does and does not protect against.

Report a way around that boundary (raw text or tool output in `brain.db`, a file another user can
read, a hook that blocks or fails a session) privately through
[a security advisory](https://github.com/johantor/brain/security/advisories/new), not in a public
issue.
