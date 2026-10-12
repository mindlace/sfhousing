import {
  Layer,
  COORDINATE_SYSTEM,
  project32,
  picking,
  gouraudMaterial,
  type LayerProps,
  type PickingInfo,
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
  ownership?: { cancelled: boolean; released: boolean };
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

/** Admission charge before creating the layer: all mesh, visibility, picking and uniform buffers. */
export function roofGpuBytes(chunk: DecodedRoofChunk): number {
  return (
    chunk.positions.byteLength +
    chunk.normals.byteLength +
    chunk.indices.byteLength +
    chunk.pieceSlots.length * (3 * 4 + 4) +
    uniformBytes
  );
}

type RoofBuffers = Partial<
  Record<'positions' | 'normals' | 'indices' | 'pickingColors' | 'visibility', Buffer>
>;

/** One non-instanced indexed model per chunk. Preparation must remain visible to deck's draw pass. */
export class RoofMeshLayer extends Layer<RoofMeshLayerProps> {
  static layerName = 'RoofMeshLayer';
  declare state: { model?: Model; buffers: RoofBuffers; ready: boolean; failed: boolean };

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

  /** Actual owned bytes after initialization; zero after failure/eviction. */
  get gpuBytes(): number {
    const live = this.getCurrentLayer() as RoofMeshLayer | null;
    if (live && live !== this) return live.gpuBytes;
    return (
      Object.values(this.state?.buffers ?? {}).reduce((n, b) => n + b.byteLength, 0) +
      [...(this.state?.model?._uniformStore.uniformBuffers.values() ?? [])].reduce(
        (n, b) => n + b.byteLength,
        0
      )
    );
  }

  initializeState(): void {
    this.setState({ buffers: {}, ready: false, failed: false });
    if (!this.props.ownership?.cancelled) this.prepare();
  }

  /** True means no GPU ownership ever began; otherwise wait for onFinalize. */
  cancelPreparation(): boolean {
    this.props.ownership!.cancelled = true;
    const live = this.getCurrentLayer() as RoofMeshLayer | null;
    if (live?.state?.buffers || this.state?.buffers) return false;
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
      !piece ||
      (piece.parcelId !== null && this.props.hidden.has(piece.parcelId as ParcelId))
    )
      // deck supports null to cancel picking, but 9.4's base signature omits null.
      return null as unknown as PickingInfo;
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
    this.props.onFinalize?.();
  }

  private prepare(): void {
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
      const shaders = this.getShaders({ vs: roofVertexShader, fs: roofFragmentShader, modules });
      this.state.model = new Model(this.context.device, {
        ...shaders,
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
    this.props.onFailure(error instanceof Error ? error : new Error(String(error)));
  }
  private release(): void {
    // Pinned luma 9.4 Model.destroy releases shaders/UBOs but does not destroy its VAO.
    this.state.model?.vertexArray.destroy();
    this.state.model?.destroy();
    this.state.model = undefined;
    this.releaseBuffers();
  }
  private releaseBuffers(): void {
    for (const buffer of Object.values(this.state.buffers)) buffer.destroy();
    this.state.buffers = {};
  }
}
