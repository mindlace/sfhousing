<script lang="ts">
  // Test double for RunLayer: records its props and each feed object it is given. No canvas.
  import { runLayer, type RunLayerStubProps } from './run-layer-stub';

  let props: RunLayerStubProps = $props();

  $effect.pre(() => {
    runLayer.feeds.add(props.feed);
    runLayer.props = { ...props };
  });
</script>

<div data-testid="run-layer"></div>
