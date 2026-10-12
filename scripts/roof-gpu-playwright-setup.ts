import { chromium, type FullConfig } from '@playwright/test';
import { roofGpuCapability } from './roof-gpu-capability';

export default async function setup(config: FullConfig) {
  const use = config.projects[0].use;
  const browser = await chromium.launch({ ...use.launchOptions, headless: use.headless });
  try {
    const page = await browser.newPage();
    const capability = await page.evaluate(roofGpuCapability);
    console.log('REQUIRED_ROOF_GPU', capability);
    if (!capability.parallel || /SwiftShader|llvmpipe|Software/i.test(capability.renderer))
      throw new Error(
        'Required roof GPU gate needs a hardware context with KHR_parallel_shader_compile'
      );
  } finally {
    await browser.close();
  }
}
