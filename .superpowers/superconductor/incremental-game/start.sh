#!/bin/sh
# Conductor helper: Phase 2, Starting an operator, steps 1-5 for a first launch.
# usage: start.sh <unit> <yes|no admitted> "<needs rows>" "<produces>" "<rationale>"
set -eu
P=/Users/mindlace/Projects/sfhousing; W=$P/.claude/worktrees/incremental-game; L=$W/.superpowers/superconductor/incremental-game
B=/Users/mindlace/.claude/plugins/cache/super/supersonic/0.5.0/skills/superconductor/beat.sh
u=$1; adm=$2; needs=$3; prod=$4; why=$5; n=incremental-game-$u; wt=$P/.claude/worktrees/$n
git -C $P worktree list | grep -q "/$n " || git -C $P worktree add $wt -b $n superconductor/incremental-game >/dev/null
cmd=$(python3 $L/mkassign.py $u $adm "$needs")
start=$(git -C $wt rev-parse HEAD)
st=planning; [ $adm = yes ] && st=admitted
line() { python3 - "$L/ledger.md" "$1" "$2" <<'PY'
import sys
p,sec,line=sys.argv[1:4]; s=open(p).read()
h="\n## %s\n"%sec; i=s.index(h)+len(h); j=s.find("\n## ",i)
j=len(s) if j<0 else j
body=s[i:j].rstrip("\n"); body=(body+"\n" if body else "")+line+"\n"
open(p,"w").write(s[:i]+body+s[j:])
PY
}
meta="(branch $n, worktree $wt, start $start, model opus — rationale: $why, needs: $needs, produces: $prod)"
line Units "- $u: $n — status: launching $meta"
sh $B $L launching $u
sh -c "$cmd"
pct=$(sh $(dirname $B)/budget.sh 2>/dev/null | sed -n 's/^SEVEN_DAY: used \([0-9]*%\).*/\1/p')
line Units "- $u: $n — status: $st $meta"
sh $B $L launched $u
sid=$(cat $L/assignments/$u.session 2>/dev/null || echo unknown)
line Cost "- $u: admitted $(date +%Y-%m-%dT%H:%M) seven_day $pct | session $sid"
sh $B $L seen $u
