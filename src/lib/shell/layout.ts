/** Routes that fill the viewport (map pages) instead of flowing as documents. */
export function isFullHeightRoute(routeId: string | null): boolean {
  return (
    routeId === '/' ||
    routeId === '/sim' ||
    (routeId?.startsWith('/p/[id]') ?? false) ||
    (routeId?.startsWith('/s/[id]') ?? false)
  );
}
