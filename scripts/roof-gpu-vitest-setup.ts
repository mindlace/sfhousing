import { beforeAll, expect } from 'vitest';
import { roofGpuCapability } from './roof-gpu-capability';

beforeAll(() => {
  const capability = roofGpuCapability();
  console.warn('REQUIRED_ROOF_GPU', capability);
  expect(capability.parallel, 'Required roof GPU gate needs KHR_parallel_shader_compile').toBe(
    true
  );
  expect(capability.renderer).not.toMatch(/SwiftShader|llvmpipe|Software/i);
});
