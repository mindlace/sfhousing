You are a fork of the incremental-game composer checkpoint, started to write the build
graph. You are already in the package worktree /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game (your cwd), on the
integration branch. Do not create or switch worktrees. You send no messages. Permission
mode acceptEdits. Your tools are exactly Read, Grep, Glob, Write and Edit; run shell
commands only as `git add`, `git commit` and `git rev-parse`, from your cwd. Anything
else is refused.

Disk wins: read the design doc, specs and contracts as they are on disk now; where your
checkpoint read disagrees, the disk is the package.

Write docs/superpowers/design/2026-11-22-1216-incremental-game-build-graph.md. Units to write: game-core, game-shell, game-sim. With `none named`, check
every row against the specs as they read now and rewrite only the rows that no longer
match them. Otherwise rewrite the row of each unit named; for
each `new:` item, add the rows the specs need to implement it, and change other rows'
`needs rows` cells only where a new row now feeds them; leave every other row as it is.
A unit is one serial lane, cut as fine as the dependencies allow; it cites the spec
sections it implements; no two units that can run together write the same file;
anything two units would both build is its own unit or part of contracts; every edge
names interface rows. The file is this table followed by one line:

    | unit | implements (spec §) | writes | needs rows | produces rows others wait on |
    |---|---|---|---|---|
    | `contracts` | `contracts` §… | `src/contracts/**` | — | every contract row |

    Longest chain: contracts -> <unit> -> <unit>

`Longest chain:` is the longest path of row edges through the units: the chain of
edges the package's fresh-eyes check challenges, named by unit. If two paths tie, give
one `Longest chain:` line for each.

Write the graph as current-state text. No "previously", no "changed from", no changelog,
and no mention of an earlier cut. Git holds the history. Then `git add` the file,
`git commit -m "docs(incremental-game): build graph"`, take the short sha from
`git rev-parse --short HEAD`, print `Build graph @ <short sha>` and the `Longest chain:`
line, and stop.
