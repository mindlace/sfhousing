#!/usr/bin/env python3
"""Conductor helper: write assignments/<unit>.md from operator-briefing.md and the build graph.

usage: mkassign.py <unit-slug> <admitted yes|no> "<needs rows line>"
Prints the launch command for the unit (Phase 2, Starting an operator, step 4).
"""
import os
import re
import sys

SKILL = '/Users/mindlace/.claude/plugins/cache/super/supersonic/0.5.0/skills/superconductor'
PROJECT = '/Users/mindlace/Projects/sfhousing'
PKG = PROJECT + '/.claude/worktrees/incremental-game'
L = PKG + '/.superpowers/superconductor/incremental-game'
GRAPH = PKG + '/docs/superpowers/design/2026-11-22-1216-incremental-game-build-graph.md'
SDD = '/Users/mindlace/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.2/skills/subagent-driven-development/scripts'
HTML = '/Users/mindlace/.claude/plugins/cache/super/superpowers-html/0.1.0/bin'
SLUG = 'incremental-game'

NOTES = (
    'Project notes (put these in every implementer and fix-round brief they apply to): '
    '(1) Port 4173 is shared by every session running e2e on this machine: before starting the '
    'preview server or Playwright, run `lsof -nP -iTCP:4173 -sTCP:LISTEN`; if something you did '
    'not start is listening, never kill it, wait in background `sleep` stretches until it is gone, '
    'then run; leave nothing listening when done. '
    '(2) Signoff rejects timing crutches: no `setTimeout`/`setInterval` in any spec or test helper, '
    'even zero-length, no fixed waits or raised timeouts in e2e (wait on a readiness signal); '
    '`npx chreode timing-check --head HEAD` is clean after the last commit of every task and fix '
    'round; changed e2e specs pass with `--repeat-each=5 --retries=0`; no new stderr from the '
    'preview server. '
    '(3) Do not run `npm run signoff`, `git push`, a dataset upload or a deploy unless your spec '
    'sections say this unit does; the conductor merges your branch. '
    '(4) Take no wall-clock measurements on a busy machine; `npm run test:perf` is not a gate. '
    '(5) Conventional Commits; no Claude attribution anywhere. '
    '(6) Your worktree needs `npm install` and the setup in CLAUDE.md (`.dev.vars`, '
    '`npm run data:fixture`, `npm run db:migrate`) before tests run.'
)


def row(unit):
    for line in open(GRAPH):
        if line.startswith('| `%s` |' % unit):
            cells = [c.strip() for c in line.strip().strip('|').split(' | ')]
            assert len(cells) == 5, (unit, len(cells))
            return cells
    raise SystemExit('no build-graph row for ' + unit)


def main():
    unit, admitted, needs = sys.argv[1:4]
    assert admitted in ('yes', 'no')
    _, impl, writes, _, produces = row(unit)
    name = '%s-%s' % (SLUG, unit)
    wt = '%s/.claude/worktrees/%s' % (PROJECT, name)
    cmds = ['npm', 'npx', 'lsof'] + (['aws'] if unit == 'mail-setup' else [])
    block = f"""
## Your assignment
- Name: {name}
- Conductor: {SLUG}-conductor
- Ledger: {L}/ledger.md
- Package worktree: {PKG}
- Your worktree: {wt} (you are already in it)
- Unit: {unit}
- Implements: {impl}
- Writes: {writes}
- Needs rows: {needs}
- Produces rows others wait on: {'none' if produces in ('—', '') else produces}
- Plan: none
- Siblings: none
- Admitted: {admitted}
- Replaces: none
- Permission mode: acceptEdits
- Allowed git commands: git add, git commit, git rev-parse, git log, git diff, git status, git show, git merge, git merge-base, git branch, git rm
- Allowed SDD scripts: bash {SDD}/sdd-workspace, bash {SDD}/task-brief, bash {SDD}/review-package, bash {HTML}/task-brief, python3 {HTML}/superpowers-html
- Allowed project commands: {', '.join(cmds)}
- Allowed for waiting: sleep (run in the background), TaskStop, sh {SKILL}/beat.sh changed
- Before superpowers:writing-plans, load superpowers-html:html-docs.
- {NOTES}
"""
    os.makedirs(L + '/assignments', exist_ok=True)
    path = '%s/assignments/%s.md' % (L, unit)
    open(path, 'w').write(open(SKILL + '/operator-briefing.md').read().rstrip('\n') + '\n' + block)
    tools = [
        'Read', 'Grep', 'Glob', 'Write', 'Edit', 'Skill', 'Agent', 'SendMessage', 'TodoWrite',
        'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop', 'Bash(sleep:*)',
        'Bash(sh %s/beat.sh changed:*)' % SKILL
    ]
    tools += ['Bash(git %s:*)' % g for g in
              'add commit rev-parse log diff status show merge merge-base branch rm'.split()]
    tools += ['Bash(bash %s/%s:*)' % (SDD, s) for s in ('sdd-workspace', 'task-brief', 'review-package')]
    tools += ['Bash(bash %s/task-brief:*)' % HTML, 'Bash(python3 %s/superpowers-html:*)' % HTML]
    tools += ['Bash(%s:*)' % c for c in cmds] + ['Bash(jev:*)']
    model = sys.argv[4] if len(sys.argv) > 4 else 'opus'
    print('env -C "%s" CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 claude --bg -n %s --model %s --permission-mode acceptEdits '
          '--allowedTools="%s" --add-dir="%s" "$(cat %s)"'
          % (wt, name, model, ','.join(tools), L, path))


main()
