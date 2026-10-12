import {
  Layer,
  COORDINATE_SYSTEM,
  project32,
  picking,
  gouraudMaterial,
  type LayerProps,
  type UpdateParameters,
  type GetPickingInfoParams,
  type LayerContext
} from '@deck.gl/core';
import { Buffer, makeShaderBlockLayout } from '@luma.gl/core';
import { Model, ShaderInputs } from '@luma.gl/engine';
import type { DecodedRoofChunk } from '$lib/data/building-roofs';
import type { ParcelId } from '$lib/data/parcel';
import { hexToRgba, TOKENS } from './palette';
import type { Theme } from './types';
import { RoofProgram, ROOF_PROGRAM_BYTES } from './roof-program';
import { roofUniforms, roofVertexShader, roofFragmentShader } from './roof-shaders';

export type RoofMeshLayerProps = {
  chunk: DecodedRoofChunk;
  hidden: ReadonlySet<ParcelId>;
  visibilityRevision: number;
  theme: Theme;
  active: boolean;
  onReady(): void;
  onFailure(error: Error): void;
  onFinalize?(): void;
  /** Shared across deck clones; cancelled pending instances must never allocate. */
  ownership?: { cancelled: boolean; released: boolean; resources?: RoofLayerState };
};
const modules = [project32, picking, gouraudMaterial, roofUniforms];
const inputs = new ShaderInputs(
  Object.fromEntries(modules.map((m) => [m.name, m])) as ConstructorParameters<
    typeof ShaderInputs
  >[0]
);
// Pinned luma 9.4 UniformStore allocates max(1024, std140 layout bytes) per uniform block.
// deck adds its own layer.opacity block. Browser tests reconcile this with actual allocations.
const uniformBytes =
  1024 +
  Object.values(inputs.modules).reduce(
    (bytes, module) =>
      bytes +
      (module.uniformTypes && Object.keys(module.uniformTypes).length
        ? Math.max(
            1024,
            makeShaderBlockLayout(module.uniformTypes, { layout: 'std140' }).byteLength
          )
        : 0),
    0
  );

/** Admission: measured buffers plus conservative program/source ownership reservation. */
export function roofGpuBytes(chunk: DecodedRoofChunk): number {
  return (
    chunk.positions.byteLength +
    chunk.normals.byteLength +
    chunk.indices.byteLength +
    chunk.pieceSlots.length * (3 * 4 + 4) +
    uniformBytes +
    ROOF_PROGRAM_BYTES
  );
}

type RoofBuffers = Partial<
  Record<'positions' | 'normals' | 'indices' | 'pickingColors' | 'visibility', Buffer>
>;

type RoofLayerState = {
  program?: RoofProgram;
  model?: Model;
  buffers: RoofBuffers;
  ready: boolean;
  failed: boolean;
};

/** One non-instanced indexed model per chunk. Preparation must remain visible to deck's draw pass. */
export class RoofMeshLayer extends Layer<RoofMeshLayerProps> {
  static layerName = 'RoofMeshLayer';
  declare state: RoofLayerState;

  constructor(props: RoofMeshLayerProps & Partial<LayerProps>) {
    super({
      ...props,
      ownership: props.ownership ?? { cancelled: false, released: false },
      id: `existing-roof-${props.chunk.header.chunkId}`,
      pickable: true,
      coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
      coordinateOrigin: [...props.chunk.header.anchor, 0]
    });
  }

  /** Owned buffer bytes plus program/source reservation; opaque executable storage is not measurable. */
  get gpuBytes(): number {
    // The original may never initialize: pre-reconciliation clones have no deck state link.
    const resources = this.props.ownership?.resources;
    return (
      (resources?.program?.accountedBytes ?? 0) +
      Object.values(resources?.buffers ?? {}).reduce((n, b) => n + b.byteLength, 0) +
      [...(resources?.model?._uniformStore.uniformBuffers.values() ?? [])].reduce(
        (n, b) => n + b.byteLength,
        0
      )
    );
  }

  initializeState(): void {
    this.setState({ buffers: {}, ready: false, failed: false });
    const ownership = this.props.ownership!;
    if (!ownership.cancelled && !ownership.released) {
      // deck mutates/transfers this same state object to subsequent matched clones.
      ownership.resources = this.state;
      this.prepare();
    }
  }

  /** True means no GPU ownership ever began; otherwise wait for onFinalize. */
  cancelPreparation(): boolean {
    const ownership = this.props.ownership!;
    ownership.cancelled = true;
    if (ownership.resources) {
      if (!ownership.resources.model) ownership.resources.program?.destroy();
      return false;
    }
    this.notifyFinalized();
    return true;
  }

  updateState({ props, oldProps }: UpdateParameters<Layer<RoofMeshLayerProps>>): void {
    if (props.ownership?.cancelled) return;
    if (oldProps.chunk && props.chunk !== oldProps.chunk) {
      this.release();
      this.setState({ ready: false, failed: false });
      this.prepare();
    } else if (
      props.visibilityRevision !== oldProps.visibilityRevision ||
      props.hidden !== oldProps.hidden
    ) {
      try {
        this.uploadVisibility();
      } catch (error) {
        this.fail(error);
      }
    }
  }

  draw(): void {
    const model = this.state.model;
    if (!model || this.state.failed || this.props.ownership?.cancelled) return;
    try {
      model.shaderInputs.setProps({
        roof: {
          color: hexToRgba(TOKENS[this.props.theme].existing).map((n) => n / 255),
          isActive: Number(this.props.active)
        }
      });
      // Inactive models still compile, bind and submit; their fragments discard in both passes.
      if (model.draw(this.context.renderPass)) {
        if (!this.state.ready) {
          this.state.ready = true;
          this.props.onReady();
        }
      } else if (model.pipeline.isErrored) {
        this.fail(
          new Error(
            `Roof pipeline failed: ${this.id}: ${JSON.stringify([model.pipeline.vs.getCompilationInfoSync(), model.pipeline.fs?.getCompilationInfoSync()])}`
          )
        );
      } else {
        const validationError = model.vertexArray.getDrawValidationError();
        if (validationError) this.fail(new Error(validationError));
        else this.setNeedsRedraw();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  getPickingInfo({ info }: GetPickingInfoParams) {
    const piece = this.props.chunk.header.pieces[info.index];
    if (
      !this.props.active ||
      this.props.ownership?.cancelled ||
      !piece ||
      (piece.parcelId !== null && this.props.hidden.has(piece.parcelId as ParcelId))
    ) {
      // Pinned deck's hover-leave path dereferences info.layer even for index -1.
      // Preserve that identity and clear the object instead of returning null.
      info.picked = false;
      info.index = -1;
      info.object = undefined;
      return info;
    }
    info.object = piece;
    return info;
  }

  finalizeState(context: LayerContext): void {
    // Clear our model before base cleanup so all release paths share exactly one owner.
    this.release();
    super.finalizeState(context);
    this.notifyFinalized();
  }

  private notifyFinalized(): void {
    const ownership = this.props.ownership!;
    if (ownership.released) return;
    ownership.released = true;
    ownership.resources = undefined;
    this.props.onFinalize?.();
  }

  private prepare(): void {
    try {
      const shaders = this.getShaders({ vs: roofVertexShader, fs: roofFragmentShader, modules });
      const state = this.state;
      const program = new RoofProgram(this.context.device, shaders);
      state.program = program;
      program.start(
        () => {
          const layer = this.getCurrentLayer() as RoofMeshLayer | null;
          if (!layer || layer.state !== state || layer.props.ownership?.cancelled) return;
          layer.prepareModel(shaders);
          layer.setNeedsRedraw();
        },
        (error) => {
          const layer = this.getCurrentLayer() as RoofMeshLayer | null;
          if (layer && layer.state === state && !layer.props.ownership?.cancelled)
            layer.fail(error);
        }
      );
    } catch (error) {
      this.fail(error);
    }
  }

  private prepareModel(shaders: ReturnType<RoofMeshLayer['getShaders']>): void {
    try {
      const { chunk } = this.props;
      const create = (key: keyof RoofBuffers, data: Float32Array | Uint32Array, index = false) => {
        // Allocate without retaining props.data; staging arrays are collectible after write.
        const buffer = this.context.device.createBuffer({
          id: `${this.id}-${key}`,
          byteLength: data.byteLength,
          usage: (index ? Buffer.INDEX : Buffer.VERTEX) | Buffer.COPY_DST,
          ...(index ? { indexType: 'uint32' as const } : {})
        });
        this.state.buffers[key] = buffer;
        buffer.write(data);
        return buffer;
      };
      const positions = create('positions', chunk.positions);
      const normals = create('normals', chunk.normals);
      const indices = create('indices', chunk.indices, true);
      const colors = new Float32Array(chunk.pieceSlots.length * 3);
      for (let i = 0; i < chunk.pieceSlots.length; i++)
        colors.set(this.encodePickingColor(chunk.pieceSlots[i]), i * 3);
      const pickingColors = create('pickingColors', colors);
      const visibility = create('visibility', new Float32Array(chunk.pieceSlots.length));
      this.uploadVisibility();
      this.state.model = new Model(this.context.device, {
        ...shaders,
        shaderFactory: this.state.program!.shaderFactory,
        pipelineFactory: this.state.program!.pipelineFactory,
        // Keep constructor-stage UBO allocation empty. Retain the model before allocating
        // uniforms so partial allocation failures can release its managed UniformStore.
        shaderInputs: new ShaderInputs({}),
        id: this.id,
        isInstanced: false,
        topology: 'triangle-list',
        indexBuffer: indices,
        indexCount: chunk.indices.length,
        vertexCount: chunk.positions.length / 3,
        bufferLayout: [
          { name: 'positions', format: 'float32x3' },
          { name: 'normals', format: 'float32x3' },
          { name: 'pickingColors', format: 'float32x3' },
          { name: 'visibility', format: 'float32' }
        ],
        attributes: { positions, normals, pickingColors, visibility }
      });
      const shaderInputs = new ShaderInputs(
        Object.fromEntries(
          shaders.modules.map((module: { name: string }) => [module.name, module])
        ),
        { disableWarnings: true }
      );
      this.state.model.setShaderInputs(shaderInputs);
    } catch (error) {
      this.fail(error);
    }
  }

  private uploadVisibility(): void {
    if (this.state.failed) return;
    const { chunk, hidden } = this.props;
    const visibility = new Float32Array(chunk.pieceSlots.length);
    for (let i = 0; i < visibility.length; i++) {
      const parcel = chunk.header.pieces[chunk.pieceSlots[i]].parcelId;
      visibility[i] = parcel !== null && hidden.has(parcel as ParcelId) ? 0 : 1;
    }
    this.state.buffers.visibility?.write(visibility);
  }
  private fail(error: unknown): void {
    if (this.state.failed) return;
    this.state.failed = true;
    this.release();
    const state = this.state;
    const { chunk, ownership } = this.props;
    const failure = error instanceof Error ? error : new Error(String(error));
    // Failure may occur inside deck's initial layer reconciliation. Publishing removal
    // there would be overwritten when LayerManager clears its current update backlog.
    // Release immediately, but notify only after that stack completes, if still owned.
    queueMicrotask(() => {
      const layer = this.getCurrentLayer() as RoofMeshLayer | null;
      if (
        !ownership?.cancelled &&
        !ownership?.released &&
        layer?.state === state &&
        state.failed &&
        layer.props.chunk === chunk
      )
        layer.props.onFailure(failure);
    });
  }
  private release(): void {
    // Pinned luma 9.4 Model.destroy releases shaders/UBOs but does not destroy its VAO.
    this.state.model?.vertexArray.destroy();
    this.state.model?.destroy();
    this.state.model = undefined;
    this.state.program?.destroy();
    this.state.program = undefined;
    this.releaseBuffers();
  }
  private releaseBuffers(): void {
    for (const buffer of Object.values(this.state.buffers)) buffer.destroy();
    this.state.buffers = {};
  }
}
