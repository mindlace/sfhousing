<script lang="ts">
  import Layout from './Layout.svelte';
  import { EMAIL_COPY } from './copy';
  import { Heading, Text, Button } from '@better-svelte-email/components';

  let {
    preview,
    heading,
    body,
    cta,
    url,
    footer = EMAIL_COPY.linkFooter
  }: {
    preview: string;
    heading: string;
    body: string;
    cta: string;
    url: string;
    footer?: string;
  } = $props();
</script>

<Layout {preview}>
  <Heading as="h1" class="m-0 mb-[12px] text-[20px] font-bold text-[#18181b]">
    {heading}
  </Heading>
  <Text class="m-0 mb-[20px] text-[14px] text-[#3f3f46]">{body}</Text>
  <Button
    href={url}
    pX={20}
    pY={12}
    class="rounded-[8px] bg-[#4f46e5] text-[14px] font-medium text-[#ffffff]"
  >
    {cta}
  </Button>
  <Text class="mt-[20px] mb-0 text-[13px] text-[#52525b]">
    {footer}
  </Text>
</Layout>
