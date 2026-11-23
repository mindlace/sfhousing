#!/usr/bin/env python3
"""Conductor helper: run queued amending forks one at a time, with the ledger lines each step owes.

usage: rulechain.py graph-only <qid> | rulechain.py <qid> [<qid> ...]

For each question: adjudication fork -> `routing` line and the question line's commit part ->
build-graph fork when the ruling changes the design -> a new checkpoint when one is due.
It never writes `routed <id>`: the conductor reads each ruling, sends relays, then ledgers that.
It stops at the first fork with no output; the conductor handles that as When a fork exits.
"""
import json
import re
import subprocess
import sys
import time

SK = '/Users/mindlace/.claude/plugins/cache/super/supersonic/0.5.0/skills'
W = '/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game'
L = W + '/.superpowers/superconductor/incremental-game'
BEAT = SK + '/superconductor/beat.sh'
SETTINGS = '{"env":{"CLAUDE_CODE_EXPERIMENTAL_CODE_MODE":"1"}}'
STEM = '2026-11-22-1216-incremental-game'
TRIP = set(sys.argv[sys.argv.index('--trip') + 1].split(',')) if '--trip' in sys.argv else set()


def now():
    return time.strftime('%Y-%m-%dT%H:%M')


def ledger():
    return open(L + '/ledger.md').read()


def add(section, line):
    s = ledger()
    h = '\n## %s\n' % section
    i = s.index(h) + len(h)
    j = s.find('\n## ', i)
    j = len(s) if j < 0 else j
    body = s[i:j].rstrip('\n')
    body = (body + '\n' if body else '') + line + '\n'
    open(L + '/ledger.md', 'w').write(s[:i] + body + s[j:])


def sub(pattern, repl):
    s = ledger()
    s2, n = re.subn(pattern, repl, s, count=1, flags=re.M)
    assert n == 1, pattern
    open(L + '/ledger.md', 'w').write(s2)


def checkpoint():
    lines = [l for l in ledger().split('\n## Checkpoints\n')[1].split('\n## ')[0].split('\n')
             if l.startswith('- ')]
    last = lines[-1].split(' | ')
    return last[0][2:].strip(), last[2].split('@')[1].strip(), len(lines)


def git(*a):
    return subprocess.run(['git', '-C', W] + list(a), capture_output=True, text=True).stdout.strip()


def section(name):
    src = open(SK + '/supercomposer/composer-forks.md').read()
    body = src.split('\n## %s\n' % name)[1].split('\n## ')[0].split('Prompt:\n', 1)[1]
    body = '\n'.join(l[4:] if l.startswith('    ') else l for l in body.split('\n')).strip() + '\n'
    return (body.replace('<design-slug>', 'incremental-game').replace('<package worktree>', W)
            .replace('<ledger dir>', L).replace('<design-file-stem>', STEM))


def fork(name, tools, prompt, out, resume=True, add_dir=True, json_out=False):
    open('%s/prompts/%s.md' % (L, name), 'w').write(prompt)
    add('Forks', '- fork %s started %s' % (name, now()))
    cmd = ['sh', BEAT, L, 'fork', name, 'env', '-C', W, 'claude', '-p']
    if resume:
        cmd += ['--resume', checkpoint()[0], '--fork-session']
    cmd += ['--model', 'opus', '--settings', SETTINGS]
    if json_out:
        cmd += ['--output-format', 'json']
    else:
        cmd += ['--permission-mode', 'acceptEdits']
    cmd += ['--allowedTools=' + tools]
    if add_dir:
        cmd += ['--add-dir=' + L]
    cmd += [prompt]
    with open(out, 'w') as f:
        st = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT if not json_out else None,
                            stdin=subprocess.DEVNULL).returncode
    return st


def exited(name, st, ok):
    add('Forks', '- fork %s exited [%s]: %s' % (name, st, 'output' if ok else 'no output'))
    if not ok:
        print('STOP: fork %s exited [%s] with no output' % (name, st))
        sys.exit(1)


def rule(qid):
    import os
    name = 'rule-' + qid
    rf = '%s/rulings/%s.md' % (L, qid)
    if not os.path.exists(rf):
        p = section('Adjudication fork')
        p = (p.replace('question <id>', 'question ' + qid).replace('<id>.md', qid + '.md')
             .replace('rule <id>', 'rule ' + qid).replace('# Ruling <id>', '# Ruling ' + qid)
             .replace('<state file>', '%s/prompts/%s.cite.json' % (L, name)))
        plans = [l for l in ledger().split('\n## Supervision\n')[1].split('\n## ')[0].split('\n')
                 if l.startswith('- plan ')]
        p = p.replace("Running units' plans are at: <unit-slug>: <plan path>, one per line.",
                      "Running units' plans are at:\n   " +
                      ('\n   '.join(l[7:] for l in plans) if plans else '(no unit has a plan yet)'))
        st = fork(name, 'Read,Grep,Glob,Write,Edit,Skill,Bash(jev:*),Bash(git add:*),'
                  'Bash(git commit:*),Bash(git rev-parse:*)', p, '%s/prompts/%s.out' % (L, name))
        exited(name, st, os.path.exists(rf))
    r = open(rf).read()
    commit = re.search(r'^Package commit: (\S+)', r, re.M).group(1)
    design = re.search(r'^Changes design: (\S+)', r, re.M).group(1)
    contract = re.search(r'^Changes contract: (\S+)', r, re.M).group(1)
    if ('- routing %s:' % qid) not in ledger():
        add('Questions', '- routing %s: rulings/%s.md, commit %s' % (qid, qid, commit))
        sub(r'^(- \S+ %s from .*→)$' % re.escape(qid),
            lambda m: m.group(1) + ' rulings/%s.md (commit %s, changes contract: %s)' % (qid, commit, contract))
    if design == 'yes' and ('- build graph for %s ' % qid) not in ledger():
        bg = r.split('\n## Build graph\n')[1].strip() if '\n## Build graph\n' in r else ''
        items = [l[2:].strip() for l in bg.split('\n') if l.startswith('- ')]
        graph(qid, commit, items)
    due = contract == 'yes' or qid in TRIP
    cp_id, cp_sha, n = checkpoint()
    rules = git('log', '--first-parent', '--oneline', '--grep=^docs(incremental-game): rule ', cp_sha + '..HEAD')
    unrules = git('log', '--first-parent', '--oneline', '--grep=^docs(incremental-game): unrule ', cp_sha + '..HEAD')
    count = len(rules.splitlines()) - len(unrules.splitlines())
    if (due or count >= 5) and ('| ruling %s' % qid) not in ledger():
        newcp(n + 1, qid)
    aff = r.split('\n## Affected units\n')[1].split('\n## ')[0] if '\n## Affected units\n' in r else ''
    named = [l[2:].split(':')[0].strip() for l in aff.split('\n') if l.startswith('- ')]
    started = set(re.findall(r'^- (\S+): incremental-game-\S+ — status:', ledger(), re.M))
    hit = [u for u in named if u in started]
    if hit:
        print('RELAY NEEDED %s: %s' % (qid, ', '.join(hit)))
    elif ('- routed %s' % qid) not in ledger():
        add('Questions', '- routed %s' % qid)
    print('ruled %s: commit %s design %s contract %s' % (qid, commit, design, contract))


def graph(qid, commit, items):
    name = 'graph-' + qid
    p = section('Build-graph fork')
    units = ', '.join(items) if items else 'none named'
    p = re.sub(r'Units to write: <all \|\s+unit-slug, unit-slug, \.\.\., new: <what>, \.\.\. \| none named>\.',
               'Units to write: %s.' % units, p)
    assert 'Units to write: %s.' % units in p
    st = fork(name, 'Read,Grep,Glob,Write,Edit,Bash(git add:*),Bash(git commit:*),Bash(git rev-parse:*)',
              p, '%s/prompts/%s.out' % (L, name), add_dir=False)
    base = commit if commit != 'none' else 'HEAD~1'
    sha = git('log', '-1', '--format=%h', '--grep=^docs(incremental-game): build graph$', base + '..HEAD')
    out = open('%s/prompts/%s.out' % (L, name)).read()
    if not sha and 'Build graph @' not in out:
        exited(name, st, False)
    add('Forks', '- fork %s exited [%s]: output' % (name, st))
    if sha:
        sub(r'^(Build graph: \S+ @ )\S+$', lambda m: m.group(1) + sha)
    add('Questions', '- build graph for %s @ %s' % (qid, sha or 'none'))


def newcp(n, qid):
    name = 'checkpoint-%d' % n
    p = open(L + '/prompts/checkpoint-2.md').read()
    out = '%s/checkpoint-%d.json' % (L, n)
    st = fork(name, 'Read,Grep,Glob', p, out, resume=False, add_dir=False, json_out=True)
    try:
        sid = json.load(open(out))['session_id']
    except Exception:
        sid = None
    add('Forks', '- fork %s exited [%s]: %s' % (name, st, 'output' if sid else 'no output'))
    if sid:
        sub(r'(\n## Checkpoints\n(?:.*\n)*?)(\n## )',
            lambda m: m.group(1).rstrip('\n') + '\n- %s | model opus | package @ %s | %s | ruling %s\n' %
            (sid, git('rev-parse', '--short', 'HEAD'), time.strftime('%Y-%m-%d'), qid) + m.group(2))


args = [a for a in sys.argv[1:]]
if '--trip' in args:
    i = args.index('--trip')
    del args[i:i + 2]
for q in args:
    rule(q)
print('chain done')
