// Builds small GTFS trips.txt / stop_times.txt tables for tests and the mini fixture.

/** Seconds after midnight -> GTFS `HH:MM:SS`. */
export const hms = (s: number): string =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');

/** `count` start times (seconds) from `h:m`, `stepMin` minutes apart. */
export const every = (h: number, m: number, stepMin: number, count: number): number[] =>
  Array.from({ length: count }, (_, k) => (h * 60 + m + k * stepMin) * 60);

/** One run of trips: each start time is a trip calling at `stops` one minute apart. */
export interface TripSpec {
  route: string;
  dir: 0 | 1;
  stops: string[];
  starts: number[];
}

/** trips.txt and stop_times.txt for `trips`, all on `serviceId`; trip ids are t1, t2, ... */
export function tripTables(
  trips: TripSpec[],
  serviceId = 'WK'
): { 'trips.txt': string; 'stop_times.txt': string } {
  const tr = ['route_id,service_id,trip_id,direction_id'];
  const st = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  let n = 0;
  for (const t of trips) {
    for (const s0 of t.starts) {
      const id = `t${++n}`;
      tr.push(`${t.route},${serviceId},${id},${t.dir}`);
      t.stops.forEach((s, k) => {
        const time = hms(s0 + 60 * k);
        st.push(`${id},${time},${time},${s},${k + 1}`);
      });
    }
  }
  return { 'trips.txt': tr.join('\n') + '\n', 'stop_times.txt': st.join('\n') + '\n' };
}
