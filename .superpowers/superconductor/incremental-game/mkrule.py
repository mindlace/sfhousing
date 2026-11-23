#!/usr/bin/env python3
"""Conductor helper: write prompts/<fork name>.md for an adjudication fork and print its command.
usage: mkrule.py <question id> [attempt k] ; plans of running units on stdin lines 'unit: path' (or empty)"""
import sys, re
SK='/Users/mindlace/.claude/plugins/cache/super/supersonic/0.5.0/skills'
W='/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game'
L=W+'/.superpowers/superconductor/incremental-game'
qid=sys.argv[1]; k=sys.argv[2] if len(sys.argv)>2 else None
name='rule-'+qid+('@'+k if k else '')
plans=sys.stdin.read().strip() if not sys.stdin.isatty() else ''
src=open(SK+'/supercomposer/composer-forks.md').read()
sec=src.split('## Adjudication fork')[1].split('## Merge-review fork')[0]
body=sec.split('Prompt:\n',1)[1]
body='\n'.join(l[4:] if l.startswith('    ') else l for l in body.split('\n')).strip()+'\n'
body=body.replace('<design-slug>','incremental-game').replace('<package worktree>',W).replace('<ledger dir>',L)
body=body.replace('question <id>','question '+qid).replace('<id>.md',qid+'.md').replace('rule <id>','rule '+qid)
body=body.replace('<state file>',L+'/prompts/'+name+'.cite.json')
body=body.replace('Running units\' plans are at: <unit-slug>: <plan path>, one per line.',
  "Running units' plans are at:\n       "+(plans.replace('\n','\n       ') if plans else '(no unit has a plan yet)'))
# the ruling-file template keeps its literal <id> in '# Ruling <id>'
body=body.replace('# Ruling <id>','# Ruling '+qid)
open(L+'/prompts/'+name+'.md','w').write(body)
ledger=open(L+'/ledger.md').read()
cp=[l for l in ledger.split('## Checkpoints')[1].split('\n## ')[0].split('\n') if l.startswith('- ')][-1].split()[1]
print(f'sh {SK}/superconductor/beat.sh {L} fork {name} env -C "{W}" CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 claude -p --resume {cp} --fork-session --model opus --permission-mode acceptEdits --allowedTools="Read,Grep,Glob,Write,Edit,Skill,Bash(jev:*),Bash(git add:*),Bash(git commit:*),Bash(git rev-parse:*)" --add-dir="{L}" "$(cat {L}/prompts/{name}.md)" > {L}/prompts/{name}.out 2>&1')
