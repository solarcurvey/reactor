/**
 * First-party hidden-source-map symbolication.
 * Production does not serve `*.map`. Operators archive maps by release SHA
 * (optional Sentry upload). This resolver is the Sentry-or-equivalent gate:
 * a generated production stack must map back to original source with exact
 * release / env / chain tags. No-op upload is not enough.
 */

export type SourceMapJson = {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names?: string[];
  mappings: string;
};

export type GeneratedFrame = {
  functionName?: string;
  file: string;
  line: number;
  column: number;
};

export type OriginalFrame = {
  source: string;
  line: number;
  column: number;
  name?: string;
  sourceContent?: string;
};

export type ResolvedFrame = {
  generated: GeneratedFrame;
  original: OriginalFrame | null;
};

export type ReleaseTags = {
  release: string;
  protocolVersion: string;
  buildSha: string;
  reactorEnv: string;
  chainId: number;
  chainName: string;
  buildTimestamp: string;
};

export type SymbolicatedError = {
  message: string;
  frames: ResolvedFrame[];
  resolved: boolean;
  tags: ReleaseTags;
};

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((ch, i) => [ch, i]));

export function encodeVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>= 5;
    if (vlq > 0) digit |= 32;
    out += B64[digit]!;
  } while (vlq > 0);
  return out;
}

export function decodeVlq(input: string, start: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let i = start;
  let digit = 0;
  do {
    const idx = B64_INDEX.get(input[i] ?? "");
    if (idx == null) throw new Error(`invalid VLQ at ${i}`);
    digit = idx;
    result |= (digit & 31) << shift;
    shift += 5;
    i += 1;
  } while (digit & 32);
  const signed = result & 1 ? -(result >> 1) : result >> 1;
  return { value: signed, next: i };
}

type MapSegment = {
  genCol: number;
  sourceIndex?: number;
  origLine?: number;
  origCol?: number;
  nameIndex?: number;
};

function parseMappings(mappings: string): MapSegment[][] {
  const lines: MapSegment[][] = [];
  let sourceIndex = 0;
  let origLine = 0;
  let origCol = 0;
  let nameIndex = 0;
  for (const line of mappings.split(";")) {
    const segs: MapSegment[] = [];
    let genCol = 0;
    let i = 0;
    while (i < line.length) {
      if (line[i] === ",") {
        i += 1;
        continue;
      }
      const g = decodeVlq(line, i);
      genCol += g.value;
      i = g.next;
      const seg: MapSegment = { genCol };
      if (i < line.length && line[i] !== ",") {
        const s = decodeVlq(line, i);
        sourceIndex += s.value;
        seg.sourceIndex = sourceIndex;
        i = s.next;
        const ol = decodeVlq(line, i);
        origLine += ol.value;
        seg.origLine = origLine;
        i = ol.next;
        const oc = decodeVlq(line, i);
        origCol += oc.value;
        seg.origCol = origCol;
        i = oc.next;
        if (i < line.length && line[i] !== ",") {
          const n = decodeVlq(line, i);
          nameIndex += n.value;
          seg.nameIndex = nameIndex;
          i = n.next;
        }
      }
      segs.push(seg);
    }
    lines.push(segs);
  }
  return lines;
}

/** V8 stacks are 1-based. Source-map fields are 0-based. */
export function resolveFrame(map: SourceMapJson, generatedLine: number, generatedColumn: number): OriginalFrame | null {
  const lines = parseMappings(map.mappings);
  const lineIdx = generatedLine - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  const segs = lines[lineIdx] ?? [];
  if (!segs.length) return null;
  const col = Math.max(0, generatedColumn - 1);
  let best: MapSegment | undefined;
  for (const seg of segs) {
    if (seg.genCol <= col) best = seg;
    else break;
  }
  if (!best || best.sourceIndex == null || best.origLine == null || best.origCol == null) return null;
  const source = map.sources[best.sourceIndex] ?? "";
  const name = best.nameIndex != null ? map.names?.[best.nameIndex] : undefined;
  const sourceContent = map.sourcesContent?.[best.sourceIndex] ?? undefined;
  return {
    source,
    line: best.origLine + 1,
    column: best.origCol + 1,
    ...(name ? { name } : {}),
    ...(sourceContent ? { sourceContent } : {}),
  };
}

const FRAME_RE = /at (?:(?<fn>.+?) \()?(?<file>[^()\s]+):(?<line>\d+):(?<col>\d+)\)?/;

export function parseStackFrames(stack: string | undefined): GeneratedFrame[] {
  if (!stack) return [];
  const frames: GeneratedFrame[] = [];
  for (const raw of stack.split("\n")) {
    const m = raw.trim().match(FRAME_RE);
    if (!m?.groups?.file || !m.groups.line || !m.groups.col) continue;
    frames.push({
      functionName: m.groups.fn,
      file: m.groups.file,
      line: Number(m.groups.line),
      column: Number(m.groups.col),
    });
  }
  return frames;
}

export function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function mapForGeneratedFile(maps: Map<string, SourceMapJson>, file: string): SourceMapJson | undefined {
  if (maps.has(file)) return maps.get(file);
  const base = basename(file);
  if (maps.has(base)) return maps.get(base);
  for (const [key, map] of maps) {
    if (basename(key) === base || map.file === base || map.file === file) return map;
  }
  return undefined;
}

export function symbolicateError(
  err: unknown,
  maps: Map<string, SourceMapJson>,
  tags: ReleaseTags,
): SymbolicatedError {
  const error = err instanceof Error ? err : new Error(typeof err === "string" ? err : "unknown failure");
  const generated = parseStackFrames(error.stack);
  const frames = generated.map((frame) => {
    const map = mapForGeneratedFile(maps, frame.file);
    return {
      generated: frame,
      original: map ? resolveFrame(map, frame.line, frame.column) : null,
    };
  });
  return {
    message: error.message,
    frames,
    resolved: frames.some((f) => f.original != null),
    tags,
  };
}

export function encodeMappings(lines: Array<Array<[number, number, number, number, number?]>>): string {
  let sourceIndex = 0;
  let origLine = 0;
  let origCol = 0;
  let nameIndex = 0;
  return lines
    .map((segs) => {
      let genCol = 0;
      return segs
        .map((seg) => {
          const [gCol, src, oLine, oCol, name] = seg;
          let out = encodeVlq(gCol - genCol);
          genCol = gCol;
          out += encodeVlq(src - sourceIndex);
          sourceIndex = src;
          out += encodeVlq(oLine - origLine);
          origLine = oLine;
          out += encodeVlq(oCol - origCol);
          origCol = oCol;
          if (name != null) {
            out += encodeVlq(name - nameIndex);
            nameIndex = name;
          }
          return out;
        })
        .join(",");
    })
    .join(";");
}

export type SourcemapUploadPlan = {
  sentry: "upload" | "skip";
  archive: boolean;
  ok: boolean;
  reason: string;
};

/** Fail-closed when maps are required. Silent skip is only allowed without REQUIRE. */
export function planSourcemapUpload(input: {
  mapDirExists: boolean;
  sentryToken?: string;
  sentryOrg?: string;
  sentryProject?: string;
  requireMaps?: boolean;
}): SourcemapUploadPlan {
  const requireMaps = Boolean(input.requireMaps);
  if (!input.mapDirExists) {
    return {
      sentry: "skip",
      archive: false,
      ok: !requireMaps,
      reason: requireMaps
        ? "apps/web/.next/static missing — build with REACTOR_SOURCEMAPS=1"
        : "sourcemap upload skipped (no maps)",
    };
  }
  const sentryReady = Boolean(input.sentryToken && input.sentryOrg && input.sentryProject);
  return {
    sentry: sentryReady ? "upload" : "skip",
    archive: true,
    ok: true,
    reason: sentryReady
      ? "archive + sentry upload"
      : "first-party archive only (SENTRY_AUTH_TOKEN / ORG / PROJECT unset)",
  };
}
