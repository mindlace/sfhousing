// Client-test stand-in for `$app/state` (aliased in vite.config.client-test.ts only). Route
// component specs set `page.state` before rendering.
export const page: { state: App.PageState; url: URL } = {
  state: {},
  url: new URL('http://localhost/')
};
