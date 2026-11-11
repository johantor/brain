---
frontendMode: unset
backendStack: node
backendSkill: unset
frontendStack: none
frontendSkill: unset
frontendE2eTool: none
frontendUnitTestTool: unset
backendTestCommand: for t in tests/*.test.sh; do bash "$t" || exit 1; done
frontendTestCommand: none
backendBuildCommand: none
frontendBuildCommand: none
backendLintCommand: shellcheck plugin/hooks/*.sh tests/*.sh scripts/*.sh
frontendLintCommand: none
formatMatrix: none
baseBranch: main
branchNaming: <type>/<issue>-<slug>
runUrl: none
planDirectory: unset
---

The crew configuration for developing brain with the `crew` plugin; `/crew:init` reconciles it.
The plugin is `plugin/`: a Bash hook and Node modules with no dependencies, so `backendStack` is
`node` and there is no build. brain has no page, so `frontendStack` is `none`, and `lead`
dispatches only `backend` and `unit-tests`. The test command runs every `tests/*.test.sh`, as CI
does; the lint command is CI's shellcheck step.

`planDirectory` is `unset`, so plans land in the `.claude/` fallback, which this repo does not
track.
