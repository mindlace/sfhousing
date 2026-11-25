// What SimRouteStub.svelte saw: how many times it mounted and its latest props. Reset per test.
export const simRoute: {
  mounts: number;
  props: Record<string, unknown> | null;
  reset(): void;
} = {
  mounts: 0,
  props: null,
  reset() {
    simRoute.mounts = 0;
    simRoute.props = null;
  }
};
