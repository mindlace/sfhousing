import {
  Shader,
  SharedRenderPipeline,
  ShaderFactory,
  PipelineFactory,
  type Device,
  type ShaderProps,
  type RenderPipelineProps,
  type RenderPipeline,
  type ComputePipeline,
  type CompilerMessage
} from '@luma.gl/core';
import { Model, type ModelProps } from '@luma.gl/engine';

// WebGL exposes no executable-memory size. This is a conservative charge, not a GPU measurement:
// three capped source copies, 1 MiB for opaque shader/program storage, and 256 KiB metadata.
export const ROOF_PROGRAM_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 256 * 1024;
const PREPARATION_TIMEOUT_MS = 5000;
const POLL_MS = 10;
type GLDevice = Device & { gl: WebGL2RenderingContext };

class RoofShader extends Shader {
  readonly device: GLDevice;
  readonly handle: WebGLShader;
  constructor(device: GLDevice, props: ShaderProps) {
    super(device, props);
    this.device = device;
    const gl = device.gl;
    const handle = gl.createShader(
      props.stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER
    );
    if (!handle) {
      this.destroyResource();
      throw new Error('Roof shader allocation failed');
    }
    this.handle = handle;
    try {
      gl.shaderSource(handle, props.source);
      gl.compileShader(handle);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }
  get asyncCompilationStatus() {
    return Promise.resolve(this.compilationStatus);
  }
  async getCompilationInfo() {
    return this.getCompilationInfoSync();
  }
  getCompilationInfoSync(): readonly CompilerMessage[] {
    if (this.compilationStatus !== 'error') return [];
    return [
      {
        type: 'error',
        message: this.device.gl.getShaderInfoLog(this.handle) ?? 'Roof shader failed',
        lineNum: 0,
        linePos: 0
      }
    ];
  }
  destroy(): void {
    if (this.destroyed) return;
    this.device.gl.deleteShader(this.handle);
    this.destroyResource();
  }
}
class RoofSharedProgram extends SharedRenderPipeline {
  readonly device: GLDevice;
  readonly handle: WebGLProgram;
  readonly vs: RoofShader;
  readonly fs: RoofShader;
  linkStatus: 'pending' | 'success' | 'error' = 'pending';
  constructor(device: GLDevice, vs: RoofShader, fs: RoofShader) {
    super(device, { vs, fs });
    this.device = device;
    this.vs = vs;
    this.fs = fs;
    const handle = device.gl.createProgram();
    if (!handle) {
      this.destroyResource();
      throw new Error('Roof program allocation failed');
    }
    this.handle = handle;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.device.gl.deleteProgram(this.handle);
    this.destroyResource();
  }
}
class RoofShaderFactory extends ShaderFactory {
  constructor(
    device: Device,
    private lease: RoofProgram
  ) {
    super(device);
  }
  createShader(props: ShaderProps): Shader {
    return this.lease.acquireShader(props);
  }
  release(shader: Shader): void {
    this.lease.releaseShader(shader);
  }
}
class RoofPipelineFactory extends PipelineFactory {
  constructor(
    device: Device,
    private lease: RoofProgram
  ) {
    super(device);
  }
  createRenderPipeline(props: RenderPipelineProps): RenderPipeline {
    return this.lease.createPipeline(props);
  }
  release(pipeline: RenderPipeline | ComputePipeline): void {
    this.lease.releasePipeline(pipeline as RenderPipeline);
  }
}

/** Pinned luma 9.4 WebGL adapter, private to one roof's clone-shared resource owner. */
export class RoofProgram {
  readonly shaderFactory: ShaderFactory;
  readonly pipelineFactory: PipelineFactory;
  private readonly device: GLDevice;
  private sources?: { vs: string; fs: string };
  private readonly extension: KHR_parallel_shader_compile;
  private shaders: RoofShader[] = [];
  private shaderRefs = new Map<Shader, number>();
  private wrappers = new Set<RenderPipeline>();
  private shared?: RoofSharedProgram;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private startedAt = 0;

  constructor(device: Device, shaders: ModelProps) {
    this.device = device as GLDevice;
    const extension = this.device.gl.getExtension('KHR_parallel_shader_compile');
    if (!extension) throw new Error('Asynchronous roof shader compilation unavailable');
    this.extension = extension;
    if (shaders.plugins?.length || shaders.varyings?.length)
      throw new Error('Unsupported roof shader plugin or varying');
    // Exact pinned Model platform fields, and the same assembler/default/module merge as
    // Model with empty ShaderInputs. Factory acquisition below rejects any assembly drift.
    const assembler = Model.defaultProps.shaderAssembler as unknown as {
      assembleGLSLShaderPair(props: Record<string, unknown>): { vs: string; fs: string };
    };
    const { vs, fs } = assembler.assembleGLSLShaderPair({
      ...Model.defaultProps,
      ...shaders,
      platformInfo: {
        type: device.type,
        shaderLanguage: device.info.shadingLanguage,
        shaderLanguageVersion: device.info.shadingLanguageVersion,
        gpu: device.info.gpu,
        limits: device.limits,
        features: device.features
      }
    });
    // Retain only source text, not the assembler's uniform/module closures.
    this.sources = { vs, fs };
    if (this.sourceBytes > MAX_SOURCE_BYTES)
      throw new Error('Roof shader sources exceed preparation budget');
    this.shaderFactory = new RoofShaderFactory(device, this);
    this.pipelineFactory = new RoofPipelineFactory(device, this);
  }
  get sourceBytes(): number {
    return this.sources ? 2 * (this.sources.vs.length + this.sources.fs.length) : 0;
  }
  get accountedBytes(): number {
    return this.disposed ? 0 : ROOF_PROGRAM_BYTES;
  }

  start(ready: () => void, failure: (error: Error) => void): void {
    this.startedAt = performance.now();
    try {
      for (const stage of ['vertex', 'fragment'] as const) {
        this.shaders.push(
          new RoofShader(this.device, {
            stage,
            source: this.sources![stage === 'vertex' ? 'vs' : 'fs']
          })
        );
      }
      this.shared = new RoofSharedProgram(this.device, this.shaders[0], this.shaders[1]);
      const gl = this.device.gl;
      gl.attachShader(this.shared.handle, this.shaders[0].handle);
      gl.attachShader(this.shared.handle, this.shaders[1].handle);
      gl.linkProgram(this.shared.handle);
      // Poll in a later task; never ask for link/layout status before KHR completion.
      this.timer = setTimeout(() => this.poll(ready, failure), POLL_MS);
    } catch (error) {
      this.reject(error, failure);
    }
  }
  private poll(ready: () => void, failure: (error: Error) => void): void {
    if (this.disposed) return;
    try {
      const gl = this.device.gl;
      if (gl.isContextLost()) throw new Error('Roof context lost during preparation');
      if (performance.now() - this.startedAt >= PREPARATION_TIMEOUT_MS)
        throw new Error('Roof program preparation timed out');
      if (!gl.getProgramParameter(this.shared!.handle, this.extension.COMPLETION_STATUS_KHR)) {
        this.timer = setTimeout(() => this.poll(ready, failure), POLL_MS);
        return;
      }
      if (!gl.getProgramParameter(this.shared!.handle, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(this.shared!.handle) || 'Roof program link failed');
      }
      this.shared!.linkStatus = 'success';
      for (const shader of this.shaders) shader.compilationStatus = 'success';
      ready();
    } catch (error) {
      this.reject(error, failure);
    }
  }
  private reject(error: unknown, failure: (error: Error) => void): void {
    this.destroy();
    failure(error instanceof Error ? error : new Error(String(error)));
  }
  acquireShader(props: ShaderProps): Shader {
    const shader = this.shaders.find((s) => s.stage === props.stage && s.source === props.source);
    if (this.disposed || !shader || this.shared?.linkStatus !== 'success')
      throw new Error('Roof Model source differs from prepared program');
    this.shaderRefs.set(shader, (this.shaderRefs.get(shader) ?? 0) + 1);
    return shader;
  }
  releaseShader(shader: Shader): void {
    const count = this.shaderRefs.get(shader) ?? 0;
    if (count < 1) throw new Error('Roof shader released without ownership');
    this.shaderRefs.set(shader, count - 1);
  }
  createPipeline(props: RenderPipelineProps): RenderPipeline {
    if (
      this.disposed ||
      this.shared?.linkStatus !== 'success' ||
      props.vs !== this.shared.vs ||
      props.fs !== this.shared.fs
    )
      throw new Error('Roof pipeline is not prepared');
    const wrapper = this.device.createRenderPipeline({
      ...props,
      _sharedRenderPipeline: this.shared
    });
    // This lease serves exactly one Model. Pinned Model replaces its pipeline without
    // releasing the previous wrapper; retire it only after replacement succeeds. These
    // wrappers do not own the shared program/shaders, so Model can still release its old
    // shader references after this call. Keep metadata bounded across render/pick changes.
    for (const previous of this.wrappers) previous.destroy();
    this.wrappers.clear();
    this.wrappers.add(wrapper);
    return wrapper;
  }
  releasePipeline(pipeline: RenderPipeline): void {
    if (!this.wrappers.delete(pipeline))
      throw new Error('Roof pipeline released without ownership');
    pipeline.destroy();
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    // Normally Model has released every wrapper/reference. Also clean a failed constructor.
    for (const wrapper of this.wrappers) wrapper.destroy();
    this.wrappers.clear();
    this.shaderRefs.clear();
    this.shared?.destroy();
    this.shared = undefined;
    for (const shader of this.shaders) shader.destroy();
    this.shaders = [];
    this.sources = undefined;
  }
}
