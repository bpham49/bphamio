import elkModule from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import { readGraph, updateCell } from './drawio-xml.ts';

// elk.bundled.js is elkjs's self-contained build (no worker file to resolve at
// runtime), statically imported so esbuild can bundle it into bphamio. It's CJS,
// so depending on the loader the constructor arrives as the default import
// itself or under .default — take whichever is there.
type ElkCtor = typeof import('elkjs').default;
const ELK: ElkCtor =
  (elkModule as unknown as { default?: ElkCtor }).default ?? (elkModule as unknown as ElkCtor);
const elk = new ELK();

export interface RunLayoutOptions {
  parent?: string;
  direction?: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
  nodeSpacing?: number;
  layerSpacing?: number;
}

export async function runLayout(path: string, opts: RunLayoutOptions = {}): Promise<number> {
  const { parent = '1', direction = 'RIGHT', nodeSpacing = 80, layerSpacing = 140 } = opts;
  const cells = readGraph(path);
  const vertices = cells.filter((c) => c.vertex && c.parent === parent);
  const vertexIds = new Set(vertices.map((c) => c.id));
  const edges = cells.filter((c) => c.edge && c.source && c.target && vertexIds.has(c.source) && vertexIds.has(c.target));

  if (vertices.length === 0) return 0;

  const elkGraph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': String(nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
    },
    children: vertices.map((v) => ({
      id: v.id,
      width: v.geometry?.width ?? 120,
      height: v.geometry?.height ?? 60,
    })),
    edges: edges.map((e): ElkExtendedEdge => ({
      id: e.id,
      sources: [e.source as string],
      targets: [e.target as string],
    })),
  };

  const result = await elk.layout(elkGraph);
  for (const node of result.children ?? []) {
    if (node.x !== undefined && node.y !== undefined) {
      updateCell(path, node.id, { x: Math.round(node.x), y: Math.round(node.y) });
    }
  }
  return vertices.length;
}
