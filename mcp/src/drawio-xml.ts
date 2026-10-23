import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document, Element } from '@xmldom/xmldom';

const DEFAULT_STYLE = 'rounded=0;whiteSpace=wrap;html=1;';
const DEFAULT_EDGE_STYLE = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;';

// sketch=1 is a real style key draw.io's own renderer already understands natively —
// confirmed by rendering it (hand-drawn jitter + hachure fill), not something this tool
// invents. Opt-in only: appended when the caller asks for it, never applied by default.
const SKETCH_STYLE = 'sketch=1;hachureGap=4;jiggle=2;';

function applySketch(style: string, sketch: boolean | undefined): string {
  if (!sketch || style.includes('sketch=')) return style;
  return style + SKETCH_STYLE;
}

export interface Geometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  relative: boolean;
}

export interface Cell {
  id: string;
  label: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  parent: string | null;
  source: string | null;
  target: string | null;
  geometry: Geometry | null;
}

// Selects a page (a <diagram> element) by its 0-based index or its name
// attribute. Omitted defaults to the first page — every existing single-page
// file and every existing caller keeps working unchanged.
export type PageSelector = number | string;

export interface AddNodeOptions {
  id?: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: string;
  parent?: string;
  sketch?: boolean;
  page?: PageSelector;
}

export interface AddEdgeOptions {
  id?: string;
  source: string;
  target: string;
  label?: string;
  style?: string;
  parent?: string;
  sketch?: boolean;
  page?: PageSelector;
}

export interface Page {
  id: string;
  name: string;
  index: number;
}

export interface CreateDiagramOptions {
  pageName?: string;
  pageWidth?: number;
  pageHeight?: number;
  dx?: number;
  dy?: number;
  force?: boolean;
}

export interface UpdateCellOptions {
  label?: string;
  style?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  page?: PageSelector;
}

function blankXml(opts: CreateDiagramOptions): string {
  const { pageName = 'Page-1', pageWidth = 850, pageHeight = 1100, dx = 800, dy = 600 } = opts;
  return `<mxfile host="drawio-agentic" version="1.0.0"><diagram id="${randomUUID()}" name="${pageName}"><mxGraphModel dx="${dx}" dy="${dy}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram></mxfile>`;
}

function ensureFile(path: string): void {
  if (!existsSync(path)) {
    writeFileSync(path, blankXml({}), 'utf8');
  }
}

function selectDiagramEl(doc: Document, page: PageSelector | undefined): Element {
  const diagrams = doc.getElementsByTagName('diagram');
  if (diagrams.length === 0) throw new Error('load: file has no <diagram> pages');
  if (page === undefined) return diagrams[0] as Element;
  if (typeof page === 'number') {
    const el = diagrams[page];
    if (!el) throw new Error(`load: no page at index ${page} (file has ${diagrams.length})`);
    return el as Element;
  }
  for (let i = 0; i < diagrams.length; i++) {
    if (diagrams[i].getAttribute('name') === page) return diagrams[i] as Element;
  }
  throw new Error(`load: no page named "${page}"`);
}

function load(path: string, page?: PageSelector): { doc: Document; model: Element; root: Element } {
  const xml = readFileSync(path, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as Document;
  const diagramEl = selectDiagramEl(doc, page);
  const model = diagramEl.getElementsByTagName('mxGraphModel')[0] as Element;
  const root = model.getElementsByTagName('root')[0] as Element;
  return { doc, model, root };
}

function save(path: string, doc: Document): void {
  const xml = new XMLSerializer().serializeToString(doc);
  writeFileSync(path, xml, 'utf8');
}

function findCell(root: Element, id: string): Element | null {
  const cells = root.getElementsByTagName('mxCell');
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].getAttribute('id') === id) return cells[i] as Element;
  }
  return null;
}

function geometryEl(cell: Element): Element | null {
  const geos = cell.getElementsByTagName('mxGeometry');
  return geos.length ? (geos[0] as Element) : null;
}

function numAttr(el: Element, name: string): number | undefined {
  const v = el.getAttribute(name);
  return v ? Number(v) : undefined;
}

function cellToObject(cell: Element): Cell {
  const geo = geometryEl(cell);
  return {
    id: cell.getAttribute('id') as string,
    label: cell.getAttribute('value') || '',
    style: cell.getAttribute('style') || '',
    vertex: cell.getAttribute('vertex') === '1',
    edge: cell.getAttribute('edge') === '1',
    parent: cell.getAttribute('parent'),
    source: cell.getAttribute('source') || null,
    target: cell.getAttribute('target') || null,
    geometry: geo
      ? {
          x: numAttr(geo, 'x'),
          y: numAttr(geo, 'y'),
          width: numAttr(geo, 'width'),
          height: numAttr(geo, 'height'),
          relative: geo.getAttribute('relative') === '1',
        }
      : null,
  };
}

export function readGraph(path: string, page?: PageSelector): Cell[] {
  ensureFile(path);
  const { root } = load(path, page);
  const cells = root.getElementsByTagName('mxCell');
  const out: Cell[] = [];
  for (let i = 0; i < cells.length; i++) {
    const id = cells[i].getAttribute('id');
    if (id === '0' || id === '1') continue; // root + default layer
    out.push(cellToObject(cells[i] as Element));
  }
  return out;
}

export function addNode(path: string, opts: AddNodeOptions = {}): string {
  const { id, label = '', x = 40, y = 40, width = 120, height = 60, style = DEFAULT_STYLE, parent = '1', sketch, page } = opts;
  ensureFile(path);
  const { doc, root } = load(path, page);
  const cellId = id || `node-${randomUUID().slice(0, 8)}`;
  const cell = doc.createElement('mxCell');
  cell.setAttribute('id', cellId);
  cell.setAttribute('value', label);
  cell.setAttribute('style', applySketch(style, sketch));
  cell.setAttribute('vertex', '1');
  cell.setAttribute('parent', parent);
  const geo = doc.createElement('mxGeometry');
  geo.setAttribute('x', String(x));
  geo.setAttribute('y', String(y));
  geo.setAttribute('width', String(width));
  geo.setAttribute('height', String(height));
  geo.setAttribute('as', 'geometry');
  cell.appendChild(geo);
  root.appendChild(cell);
  save(path, doc);
  return cellId;
}

export function addEdge(path: string, opts: AddEdgeOptions): string {
  const { id, source, target, label = '', style = DEFAULT_EDGE_STYLE, parent = '1', sketch, page } = opts;
  ensureFile(path);
  const { doc, root } = load(path, page);
  if (!findCell(root, source) || !findCell(root, target)) {
    throw new Error(`addEdge: source or target cell not found (source=${source}, target=${target})`);
  }
  const cellId = id || `edge-${randomUUID().slice(0, 8)}`;
  const cell = doc.createElement('mxCell');
  cell.setAttribute('id', cellId);
  cell.setAttribute('value', label);
  cell.setAttribute('style', applySketch(style, sketch));
  cell.setAttribute('edge', '1');
  cell.setAttribute('parent', parent);
  cell.setAttribute('source', source);
  cell.setAttribute('target', target);
  const geo = doc.createElement('mxGeometry');
  geo.setAttribute('relative', '1');
  geo.setAttribute('as', 'geometry');
  cell.appendChild(geo);
  root.appendChild(cell);
  save(path, doc);
  return cellId;
}

export function updateCell(path: string, id: string, opts: UpdateCellOptions = {}): void {
  const { label, style, x, y, width, height, page } = opts;
  const { doc, root } = load(path, page);
  const cell = findCell(root, id);
  if (!cell) throw new Error(`updateCell: cell not found (id=${id})`);
  if (label !== undefined) cell.setAttribute('value', label);
  if (style !== undefined) cell.setAttribute('style', style);
  if (x !== undefined || y !== undefined || width !== undefined || height !== undefined) {
    const geo = geometryEl(cell);
    if (geo) {
      if (x !== undefined) geo.setAttribute('x', String(x));
      if (y !== undefined) geo.setAttribute('y', String(y));
      if (width !== undefined) geo.setAttribute('width', String(width));
      if (height !== undefined) geo.setAttribute('height', String(height));
    }
  }
  save(path, doc);
}

export function deleteCell(path: string, id: string, page?: PageSelector): number {
  const { doc, root } = load(path, page);
  const cells = root.getElementsByTagName('mxCell');
  const toRemove: Element[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] as Element;
    if (c.getAttribute('id') === id || c.getAttribute('source') === id || c.getAttribute('target') === id) {
      toRemove.push(c);
    }
  }
  for (const c of toRemove) root.removeChild(c);
  save(path, doc);
  return toRemove.length;
}

export function listPages(path: string): Page[] {
  ensureFile(path);
  const xml = readFileSync(path, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as Document;
  const diagrams = doc.getElementsByTagName('diagram');
  const out: Page[] = [];
  for (let i = 0; i < diagrams.length; i++) {
    out.push({ id: diagrams[i].getAttribute('id') ?? '', name: diagrams[i].getAttribute('name') ?? '', index: i });
  }
  return out;
}

export function addPage(path: string, opts: { name?: string } = {}): Page {
  ensureFile(path);
  const xml = readFileSync(path, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as Document;
  const mxfile = doc.getElementsByTagName('mxfile')[0] as Element;
  // getElementsByTagName is a live collection in xmldom: reading .length again
  // after mxfile.appendChild(diagramEl) below would already count the new page.
  // Snapshot it now, before insertion.
  const pageCountBefore = doc.getElementsByTagName('diagram').length;
  const name = opts.name ?? `Page-${pageCountBefore + 1}`;
  const id = randomUUID();

  const diagramEl = doc.createElement('diagram');
  diagramEl.setAttribute('id', id);
  diagramEl.setAttribute('name', name);
  const model = doc.createElement('mxGraphModel');
  model.setAttribute('dx', '800');
  model.setAttribute('dy', '600');
  model.setAttribute('grid', '1');
  model.setAttribute('gridSize', '10');
  model.setAttribute('guides', '1');
  model.setAttribute('tooltips', '1');
  model.setAttribute('connect', '1');
  model.setAttribute('arrows', '1');
  model.setAttribute('fold', '1');
  model.setAttribute('page', '1');
  model.setAttribute('pageScale', '1');
  model.setAttribute('pageWidth', '850');
  model.setAttribute('pageHeight', '1100');
  model.setAttribute('math', '0');
  model.setAttribute('shadow', '0');
  const root = doc.createElement('root');
  const cell0 = doc.createElement('mxCell');
  cell0.setAttribute('id', '0');
  const cell1 = doc.createElement('mxCell');
  cell1.setAttribute('id', '1');
  cell1.setAttribute('parent', '0');
  root.appendChild(cell0);
  root.appendChild(cell1);
  model.appendChild(root);
  diagramEl.appendChild(model);
  mxfile.appendChild(diagramEl);

  save(path, doc);
  return { id, name, index: pageCountBefore };
}

export function createDiagram(path: string, opts: CreateDiagramOptions = {}): void {
  if (existsSync(path) && !opts.force) {
    const existing = readGraph(path);
    if (existing.length > 0) {
      throw new Error(
        `createDiagram: ${path} already has ${existing.length} cell(s). Call get_graph first to see what's there, ` +
          `edit on top of it with add_node/add_edge/update_cell, or pass force:true to really replace the file.`,
      );
    }
  }
  writeFileSync(path, blankXml(opts), 'utf8');
}
