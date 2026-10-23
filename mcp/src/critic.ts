import { readGraph } from './drawio-xml.ts';
import type { Cell, PageSelector } from './drawio-xml.ts';

// Checks a diagram for the layout defects this whole project kept hand-catching
// by eyeballing PNG exports: boxes overlapping, an edge cutting through an
// unrelated box, two edges crossing without a jump arc, and a label landing on
// top of a box. It is a heuristic, not a renderer: edge paths are approximated
// as a straight line from the source box's attachment point to the target's
// (per exitX/exitY/entryX/entryY when the style sets them, else box center),
// not mxGraph's real orthogonal routing. That catches the dominant real cases
// (a straight cut through a sibling, a label parked mid-line on another box)
// but can miss or over-flag a path with multiple bends. Treat a clean report
// as "no obvious defects", not "pixel-perfect" — a visual PNG export spot
// check is still worth it before calling a dense diagram finished.

export interface AbsBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Issue {
  type: 'box-overlap' | 'edge-through-box' | 'edge-crossing' | 'label-overlap';
  message: string;
  ids: string[];
}

interface Point {
  x: number;
  y: number;
}

function parseStylePair(style: string, xKey: string, yKey: string): { x: number; y: number } | null {
  const xm = style.match(new RegExp(`${xKey}=([0-9.]+)`));
  const ym = style.match(new RegExp(`${yKey}=([0-9.]+)`));
  if (!xm || !ym) return null;
  return { x: Number(xm[1]), y: Number(ym[1]) };
}

function computeAbsoluteBoxes(cells: Cell[]): Map<string, AbsBox> {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const abs = new Map<string, AbsBox>();

  function resolve(id: string): AbsBox | null {
    if (abs.has(id)) return abs.get(id) as AbsBox;
    const cell = byId.get(id);
    if (!cell || !cell.vertex || !cell.geometry) return null;
    const { x = 0, y = 0, width = 0, height = 0 } = cell.geometry;
    let originX = 0;
    let originY = 0;
    if (cell.parent && cell.parent !== '0' && cell.parent !== '1') {
      const parentBox = resolve(cell.parent);
      if (parentBox) {
        originX = parentBox.x;
        originY = parentBox.y;
      }
    }
    const box: AbsBox = { id, x: originX + x, y: originY + y, width, height };
    abs.set(id, box);
    return box;
  }

  for (const c of cells) if (c.vertex) resolve(c.id);
  return abs;
}

function isAncestor(maybeAncestor: string, id: string, byId: Map<string, Cell>): boolean {
  let cur = byId.get(id)?.parent ?? null;
  while (cur && cur !== '0') {
    if (cur === maybeAncestor) return true;
    cur = byId.get(cur)?.parent ?? null;
  }
  return false;
}

function boxesOverlap(a: AbsBox, b: AbsBox, tolerance = 2): boolean {
  return (
    a.x + tolerance < b.x + b.width &&
    a.x + a.width - tolerance > b.x &&
    a.y + tolerance < b.y + b.height &&
    a.y + a.height - tolerance > b.y
  );
}

function attachPoint(box: AbsBox, style: string, xKey: string, yKey: string): Point {
  const pair = parseStylePair(style, xKey, yKey);
  const fx = pair?.x ?? 0.5;
  const fy = pair?.y ?? 0.5;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

function segmentVsBox(p1: Point, p2: Point, box: AbsBox): boolean {
  // Liang-Barsky clip of segment p1->p2 against the box, inset slightly so an
  // edge that merely touches a box's border (the normal case at its own
  // source/target) isn't flagged.
  const inset = 3;
  const xmin = box.x + inset;
  const xmax = box.x + box.width - inset;
  const ymin = box.y + inset;
  const ymax = box.y + box.height - inset;
  if (xmax <= xmin || ymax <= ymin) return false;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, p1.x - xmin)) return false;
  if (!clip(dx, xmax - p1.x)) return false;
  if (!clip(-dy, p1.y - ymin)) return false;
  if (!clip(dy, ymax - p1.y)) return false;
  return t0 < t1;
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return false; // parallel
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

export function evaluateDiagram(path: string, page?: PageSelector): Issue[] {
  const cells = readGraph(path, page);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const boxes = computeAbsoluteBoxes(cells);
  const vertices = cells.filter((c) => c.vertex);
  const edges = cells.filter((c) => c.edge && c.source && c.target);
  const issues: Issue[] = [];

  // 1. Sibling box overlap — not flagged when one is actually the other's
  // container (that's normal nesting, not a collision).
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const a = vertices[i];
      const b = vertices[j];
      if (isAncestor(a.id, b.id, byId) || isAncestor(b.id, a.id, byId)) continue;
      const ba = boxes.get(a.id);
      const bb = boxes.get(b.id);
      if (ba && bb && boxesOverlap(ba, bb)) {
        issues.push({
          type: 'box-overlap',
          ids: [a.id, b.id],
          message: `"${a.label || a.id}" and "${b.label || b.id}" overlap and neither contains the other`,
        });
      }
    }
  }

  // Edge path, approximated as the real orthogonal router would draw it when
  // the style pins an explicit exit/entry side: a single-bend elbow, not a
  // diagonal straight line — a diagonal is a much worse approximation for
  // these (it cuts across whatever sits between the two points, where the
  // real axis-aligned route runs clear past it). No explicit side → straight
  // line, same as before.
  const edgePath = new Map<string, Point[]>();
  for (const e of edges) {
    const sb = boxes.get(e.source as string);
    const tb = boxes.get(e.target as string);
    if (!sb || !tb) continue;
    const start = attachPoint(sb, e.style, 'exitX', 'exitY');
    const end = attachPoint(tb, e.style, 'entryX', 'entryY');
    const exitPair = parseStylePair(e.style, 'exitX', 'exitY');
    const exitsHorizontal = exitPair ? exitPair.x === 0 || exitPair.x === 1 : false;
    const exitsVertical = exitPair ? exitPair.y === 0 || exitPair.y === 1 : false;
    if (exitsHorizontal) {
      edgePath.set(e.id, [start, { x: end.x, y: start.y }, end]);
    } else if (exitsVertical) {
      edgePath.set(e.id, [start, { x: start.x, y: end.y }, end]);
    } else {
      edgePath.set(e.id, [start, end]);
    }
  }

function segments(path: Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 0; i < path.length - 1; i++) out.push([path[i], path[i + 1]]);
  return out;
}

function pathMidpoint(path: Point[]): Point {
  const segs = segments(path);
  const lengths = segs.map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y));
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total === 0) return path[0];
  let remaining = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (remaining <= lengths[i]) {
      const [a, b] = segs[i];
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    remaining -= lengths[i];
  }
  return path[path.length - 1];
}

  // 2. Edge path cutting through an unrelated box (not its own source/target,
  // and not a container that source or target lives inside of).
  for (const e of edges) {
    const path = edgePath.get(e.id);
    if (!path) continue;
    for (const v of vertices) {
      if (v.id === e.source || v.id === e.target) continue;
      // Exclude any container that's an ancestor of either endpoint (the edge
      // legitimately starts/ends inside it) AND any box that's a descendant of
      // either endpoint (a container-targeted edge ends near its own children,
      // that's not "cutting through an unrelated box").
      if (
        isAncestor(v.id, e.source as string, byId) ||
        isAncestor(v.id, e.target as string, byId) ||
        isAncestor(e.source as string, v.id, byId) ||
        isAncestor(e.target as string, v.id, byId)
      ) {
        continue;
      }
      const box = boxes.get(v.id);
      if (box && segments(path).some(([a, b]) => segmentVsBox(a, b, box))) {
        issues.push({
          type: 'edge-through-box',
          ids: [e.id, v.id],
          message: `Edge "${e.label || e.id}" (${e.source} → ${e.target}) cuts through "${v.label || v.id}"`,
        });
      }
    }
  }

  // 3. Edge crossing edge — fine if either carries jumpStyle=arc (the crossing
  // gets a visible hop), otherwise flagged.
  const edgeIds = [...edgePath.keys()];
  for (let i = 0; i < edgeIds.length; i++) {
    for (let j = i + 1; j < edgeIds.length; j++) {
      const e1 = byId.get(edgeIds[i]) as Cell;
      const e2 = byId.get(edgeIds[j]) as Cell;
      if (e1.source === e2.source || e1.source === e2.target || e1.target === e2.source || e1.target === e2.target) continue;
      const p1 = edgePath.get(edgeIds[i]) as Point[];
      const p2 = edgePath.get(edgeIds[j]) as Point[];
      let crosses = false;
      for (const [a1, b1] of segments(p1)) {
        for (const [a2, b2] of segments(p2)) {
          if (segmentsIntersect(a1, b1, a2, b2)) crosses = true;
        }
      }
      if (!crosses) continue;
      const handled = e1.style.includes('jumpStyle=arc') || e2.style.includes('jumpStyle=arc');
      if (!handled) {
        issues.push({
          type: 'edge-crossing',
          ids: [e1.id, e2.id],
          message: `Edges "${e1.label || e1.id}" and "${e2.label || e2.id}" cross without jumpStyle=arc on either`,
        });
      }
    }
  }

  // 4. Edge label sitting on top of an unrelated box — approximated at the
  // path's midpoint (by arc length), sized from the label string.
  for (const e of edges) {
    if (!e.label) continue;
    const path = edgePath.get(e.id);
    if (!path) continue;
    const mid = pathMidpoint(path);
    const labelBox: AbsBox = {
      id: `${e.id}-label`,
      x: mid.x - (e.label.length * 3.2) / 2,
      y: mid.y - 7,
      width: e.label.length * 6.4,
      height: 14,
    };
    for (const v of vertices) {
      if (v.id === e.source || v.id === e.target) continue;
      // A container that's an ancestor of either endpoint just has its own
      // (usually transparent) background under the label — not a collision.
      if (isAncestor(v.id, e.source as string, byId) || isAncestor(v.id, e.target as string, byId)) continue;
      const box = boxes.get(v.id);
      if (box && boxesOverlap(labelBox, box, 0)) {
        issues.push({
          type: 'label-overlap',
          ids: [e.id, v.id],
          message: `Label "${e.label}" on edge ${e.id} lands on top of "${v.label || v.id}"`,
        });
      }
    }
  }

  return issues;
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 0) return '';
  const byType: Record<string, Issue[]> = {};
  for (const i of issues) (byType[i.type] ??= []).push(i);
  const lines = [`⚠ ${issues.length} layout issue(s):`];
  for (const [type, list] of Object.entries(byType)) {
    for (const i of list) lines.push(`  [${type}] ${i.message}`);
  }
  return lines.join('\n');
}
