import fs from 'node:fs';
import type { RangeResponse, Source } from 'pmtiles';

/** A PMTiles `Source` over a local file (the pmtiles package ships only fetch/in-memory sources). */
export class NodeFileSource implements Source {
  constructor(private readonly path: string) {}

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const fh = await fs.promises.open(this.path, 'r');
    try {
      const buf = new Uint8Array(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      return { data: buf.slice(0, bytesRead).buffer as ArrayBuffer };
    } finally {
      await fh.close();
    }
  }

  getKey(): string {
    return this.path;
  }
}
