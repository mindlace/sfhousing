<script lang="ts">
  import {
    Html,
    Head,
    Preview,
    Body,
    Container,
    Section,
    Text,
    Hr
  } from '@better-svelte-email/components';
  import type { Snippet } from 'svelte';
  import { EMAIL_COPY } from './copy';

  let { preview, children }: { preview: string; children: Snippet } = $props();
</script>

<Html lang="en">
  <Head />
  <Preview {preview} />
  <Body class="m-0 bg-[#f4f4f5] p-0 font-sans">
    <Container
      class="mx-auto my-[24px] w-[100%] max-w-[480px] rounded-[12px] bg-[#ffffff] p-[32px]"
    >
      <Section class="pb-[16px]">
        <!-- Wordmark placeholder; swap for a logo <Img> when the asset lands. -->
        <Text class="m-0 text-[18px] font-bold text-[#18181b]">{EMAIL_COPY.wordmark}</Text>
      </Section>
      <Section>
        {@render children()}
      </Section>
      <Hr class="my-[24px] border-[#e0e0e3]" />
      <Section>
        <Text class="m-0 text-[12px] text-[#71717a]">
          {EMAIL_COPY.layoutFooter}
        </Text>
      </Section>
    </Container>
  </Body>
</Html>
