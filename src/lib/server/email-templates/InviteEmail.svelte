<script lang="ts">
  import Layout from './Layout.svelte';
  import { EMAIL_COPY } from './copy';
  import { Heading, Text, Button } from '@better-svelte-email/components';

  let {
    inviterHandle,
    simTitle,
    url
  }: {
    inviterHandle: string;
    simTitle: string;
    url: string;
  } = $props();
</script>

<Layout preview={EMAIL_COPY.invite.preview(inviterHandle)}>
  <Heading as="h1" class="m-0 mb-[12px] text-[20px] font-bold text-[#18181b]">
    {EMAIL_COPY.invite.heading(inviterHandle)}
  </Heading>
  <Text class="m-0 mb-[20px] text-[14px] text-[#3f3f46]">
    {EMAIL_COPY.invite.body(simTitle)}
  </Text>
  <Button
    href={url}
    pX={20}
    pY={12}
    class="rounded-[8px] bg-[#4f46e5] text-[14px] font-medium text-[#ffffff]"
  >
    {EMAIL_COPY.invite.cta}
  </Button>
  <Text class="mt-[20px] mb-0 text-[13px] text-[#52525b]">
    {EMAIL_COPY.invite.footer}
  </Text>
</Layout>
