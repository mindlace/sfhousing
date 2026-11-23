#!/bin/sh
# Conductor helper: relaunch an operator that has no plan yet with the current list (Phase 2, Relaunching with a longer list).
set -eu
L=/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game
B=/Users/mindlace/.claude/plugins/cache/super/supersonic/0.5.0/skills/superconductor/beat.sh
u=$1
out=$(sh $B $L stop $u); echo "$out"
case "$out" in *":live"*|*unknown*) echo "not relaunched: $u"; exit 1;; esac
cmd=$(python3 $L/mkassign.py $u)
sh $B $L relaunched $u
sh -c "$cmd" 2>&1 | grep backgrounded
sh $B $L launched $u
sh $B $L seen $u
