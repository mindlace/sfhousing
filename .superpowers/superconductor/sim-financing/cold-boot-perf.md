# Cold-boot measurements, finance engine bench (2026-11-12)

Main checkout, `main` @ 592234c3, `npm run test:perf` three times in a row after the owner's cold
boot (15 logical cores). Nothing else run during measurement. Logs: `run-1.log`, `run-2.log`,
`run-3.log` in this directory. All values below are copied from those logs.

CPU idle before each run (`top -l 2 -n 0`, second sample): run 1 92.10%, run 2 97.80%,
run 3 98.17%.

| Case                                        | Run 1     | Run 2     | Run 3     | Median    | Current budget |
| ------------------------------------------- | --------- | --------- | --------- | --------- | -------------- |
| case 2. simulateNet, bench baseline         | 30.3 ms   | 28.0 ms   | 27.5 ms   | 28.0 ms   | 30 ms          |
| case 3. plus the bench funding set          | 68.5 ms   | 65.6 ms   | 66.0 ms   | 66.0 ms   | 45 ms          |
| case 4. 101 band pairs after revision 0     | 3140.9 ms | 3133.0 ms | 3146.8 ms | 3140.9 ms | 9 s            |
| case 5. longest band/twin macrotask         | 95.5 ms   | 108.0 ms  | 96.1 ms   | 96.1 ms   | 50 ms          |
| rev0: unfunded                              | 1848.7 ms | 1863.0 ms | 1964.2 ms | 1863.0 ms | none           |
| rev0: funded baseline                       | 3805.8 ms | 3851.3 ms | 3948.7 ms | 3851.3 ms | none           |
| rev0: bench funding                         | 8101.4 ms | 8031.2 ms | 8201.1 ms | 8101.4 ms | none           |
| heap at rev 0, unfunded (host's share)      | 255 (21)  | 255 (21)  | 254 (21)  | 255 (21)  | none           |
| heap at rev 0, funded baseline (host share) | 280 (46)  | 288 (54)  | 288 (54)  | 288 (54)  | none           |
| heap at rev 0, bench funding (host share)   | 310 (76)  | 311 (76)  | 310 (76)  | 310 (76)  | none           |

Heap in MB, whole test process, gc on. Note: the whole-process heap here (254 to 311 MB) is far
above the 98/128/154 MB the doc records from the perf round; the host's share (21/54/76 MB) agrees
with the doc (24/51/77 MB). Not examined why (likely more of the suite resident in the same worker
when the full `test:perf` runs, versus the partial run the doc's numbers came from; unverified).

Case 5's longest task: run 1 and run 3 a band/twin run task, run 2 the shown run (108.0 ms).

## Failures

- Run 1: case 2 (30.3 ms > 30), case 3, case 5, timeline.perf swap install cadence.
- Runs 2 and 3: case 3, case 5, timeline.perf swap install cadence. Case 2 passed (28.0, 27.5).
- Case 4 passed in all three runs.

Case 2's run-1 miss is by 0.3 ms, in the first run after the cold boot; its median over the three
runs (28.0 ms) is under budget. Per the assignment, a case 2 failure on the quiet machine is a stop
and an escalation to `main`.

## timeline.perf "swap install cadence at 30,000 projects" (#99, not ours)

p95: run 1 389.6 ms, run 2 399.8 ms, run 3 391.6 ms (budget 50 ms; 1 frame each).

## Budgets the ruling's formula would give (not applied)

ceil(median × 1.25):

- case 3: 66.0 × 1.25 = 82.5 → 83 ms
- case 5: 96.1 × 1.25 = 120.125 → 121 ms
- rev0: unfunded: 1863.0 × 1.25 = 2328.75 → 2330 ms
- rev0: funded baseline: 3851.3 × 1.25 = 4814.125 → 4820 ms
- rev0: bench funding: 8101.4 × 1.25 = 10126.75 → 10130 ms
