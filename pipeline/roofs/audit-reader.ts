import { createReadStream } from 'node:fs';
import { Tokenizer, TokenParser, TokenType } from '@streamparser/json';
import {
  RoofBuildingAuditSchema,
  RoofPieceAuditSchema,
  type RoofBuildingAudit,
  type RoofPieceAudit
} from '../../src/lib/data/roof-audit';

/** Bounded evidence records, with compact cross-record state owned by the caller. */
export async function streamRoofAudit(
  path: string,
  datasetVersion: string,
  visit: (kind: 'buildings' | 'pieces', value: RoofBuildingAudit | RoofPieceAudit) => void,
  opts: { highWaterMark?: number } = {}
): Promise<void> {
  const tokenizer = new Tokenizer();
  const parser = new TokenParser({
    paths: ['$.schemaVersion', '$.datasetVersion', '$.buildings.*', '$.pieces.*'],
    keepStack: false
  });
  const keys = new Set<string>();
  let depth = 0,
    key = '',
    expectKey = false,
    expectValue = false,
    offset = 0,
    lastRecord = 0;
  const root: Record<string, unknown> = {};
  tokenizer.onToken = (token) => {
    offset = token.offset;
    if (
      depth === 0 &&
      token.token !== TokenType.LEFT_BRACE &&
      token.token !== TokenType.RIGHT_BRACE
    )
      throw new Error('roof audit must be an object');
    if (depth === 1 && expectKey && token.token === TokenType.STRING) {
      key = String(token.value);
      if (keys.has(key)) throw new Error('duplicate roof audit root key');
      if (!['schemaVersion', 'datasetVersion', 'buildings', 'pieces'].includes(key))
        throw new Error('unknown roof audit root key');
      keys.add(key);
      expectKey = false;
    } else if (depth === 1 && token.token === TokenType.COLON) expectValue = true;
    else if (depth === 1 && expectValue) {
      if (['buildings', 'pieces'].includes(key) && token.token !== TokenType.LEFT_BRACKET)
        throw new Error('roof audit records must be arrays');
      expectValue = false;
    }
    if (token.token === TokenType.LEFT_BRACE || token.token === TokenType.LEFT_BRACKET) {
      depth++;
      if (depth === 1) expectKey = true;
    }
    if (token.token === TokenType.RIGHT_BRACE || token.token === TokenType.RIGHT_BRACKET) depth--;
    if (depth === 1 && token.token === TokenType.COMMA) expectKey = true;
    if (depth > 64) throw new Error('roof audit nesting limit');
    parser.write(token);
  };
  parser.onValue = ({ key, value, stack }) => {
    lastRecord = offset;
    if (stack.length === 1) {
      root[String(key)] = value;
      return;
    }
    const kind = stack[1]?.key;
    if (kind !== 'buildings' && kind !== 'pieces') throw new Error('invalid roof record');
    const record =
      kind === 'buildings'
        ? RoofBuildingAuditSchema.parse(value)
        : RoofPieceAuditSchema.parse(value);
    if (record.datasetVersion !== datasetVersion)
      throw new Error('roof audit record version mismatch');
    visit(kind, record);
  };
  const stream = createReadStream(path, { highWaterMark: opts.highWaterMark ?? 64 * 1024 });
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      tokenizer.write(chunk);
      // Includes unfinished string tokens and rejects huge hostile records before unbounded growth.
      if (bytes - lastRecord > 8 * 1024 * 1024) throw new Error('roof audit record exceeds 8 MiB');
    }
    if (!tokenizer.isEnded) tokenizer.end();
    if (!parser.isEnded) parser.end();
    if (keys.size !== 4 || root.schemaVersion !== 1 || root.datasetVersion !== datasetVersion)
      throw new Error('roof audit envelope mismatch');
  } finally {
    stream.destroy();
  }
}
