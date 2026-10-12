/** Native Metal is measured on macOS. Other hosts must supply a supported hardware context. */
export const roofGpuLaunchOptions = {
  headless: process.env.ROOF_GPU_HEADED !== '1',
  args: process.platform === 'darwin' ? ['--use-angle=metal'] : []
};
