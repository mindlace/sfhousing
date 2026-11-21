import { ABOUT_ID } from '$lib/about/copy';

/**
 * The map's credit (docs/dev/about.md): "© OpenStreetMap", linked to its copyright page as the
 * OSMF guidelines ask, then the About link to Data and licences, where every credit lives.
 */
export function creditHtml(): string {
  return (
    '<a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">© OpenStreetMap</a>' +
    ' · ' +
    `<a href="/about#${ABOUT_ID.data}">About this model</a>`
  );
}
