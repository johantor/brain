## Summary

<!-- Why this change, plus anything a reviewer needs to approve safely.
BUDGET: 150 words max here, 5 bullets max, whole body under 400 words.
NOT here: self-review write-ups, narratives, pasted tool output. See AGENTS.md, "Conventions". -->

-

## Version / changelog

<!-- A change under plugin/ bumps `version` in plugin/.claude-plugin/plugin.json and adds a
matching CHANGELOG.md entry (AGENTS.md, "Releasing"). CI blocks it without a bump. -->

- [ ] Bumped the version + matching `CHANGELOG.md` entry
- [ ] N/A — nothing under plugin/ changed

## Test plan

<!-- Results, not transcripts: "ran X, all green". -->

- [ ] `shellcheck plugin/hooks/*.sh tests/*.sh scripts/*.sh`
- [ ] `bash tests/capture.test.sh` and `bash tests/release.test.sh`

## Related issues

<!-- Closes #N -->
