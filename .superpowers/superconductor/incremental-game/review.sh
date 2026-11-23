#!/bin/sh
# Conductor helper: merge-review fork. usage: review.sh <unit> <full or short sha> "<needs rows>" "<produces rows>"
# Ledger `- fork review-<unit>-<short> started` first; this appends the exited line.
W=/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game; L=$W/.superpowers/superconductor/incremental-game
SK=/Users/mindlace/.claude/plugins/cache/super/supersonic/0.5.0/skills
u=$1; sha=$2; short=$(echo $sha | cut -c1-8); n=review-$u-$short
python3 - "$L" "$u" "$sha" "$short" "$3" "$4" <<'PY'
import sys
L,u,sha,short,needs,prod=sys.argv[1:7]
t=open(L+'/review-template.md').read()
t=t.replace('Unit <unit-slug> merged at <sha>. It needs rows <rows> and produces rows <rows>.','Unit %s merged at %s. It needs rows %s and produces rows %s.'%(u,sha,needs,prod))
t=t.replace('merge-<unit-slug>-<short-sha>','merge-%s-%s'%(u,short)).replace('`No drift @ <sha>`','`No drift @ %s`'%sha)
assert '<unit-slug>' not in t and '<rows>' not in t, t
open('%s/prompts/review-%s-%s.md'%(L,u,short),'w').write(t)
PY
cp=$(sed -n '/^## Checkpoints/,/^## 2026/p' $L/ledger.md | grep '^- ' | tail -1 | cut -d' ' -f2)
sh $SK/superconductor/beat.sh $L fork $n env -C "$W" claude -p --resume $cp --fork-session --model opus --settings '{"env":{"CLAUDE_CODE_EXPERIMENTAL_CODE_MODE":"1"}}' --permission-mode acceptEdits --allowedTools="Read,Grep,Glob,Write,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git rev-parse:*)" --add-dir="$L" "$(cat $L/prompts/$n.md)" > $L/prompts/$n.out 2>&1 < /dev/null
st=$?
if grep -q "No drift @" $L/prompts/$n.out || [ -f $L/questions/merge-$u-$short.md ]; then o=output; else o="no output"; fi
python3 - "$L/ledger.md" "- fork $n exited [$st]: $o" <<'PY'
import sys
p,line=sys.argv[1:3]; s=open(p).read()
h="\n## Forks\n"; i=s.index(h)+len(h); j=s.find("\n## ",i); j=len(s) if j<0 else j
open(p,"w").write(s[:i]+s[i:j].rstrip("\n")+"\n"+line+"\n"+s[j:])
PY
echo "$n exited [$st]: $o"; grep "No drift" $L/prompts/$n.out; ls $L/questions/merge-$u-$short.md 2>/dev/null; exit 0
