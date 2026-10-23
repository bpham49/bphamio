import { createDiagram, addNode, addEdge, readGraph, updateCell, deleteCell } from '../src/drawio-xml.ts';
import assert from 'node:assert/strict';

const path = process.argv[2] || '/tmp/smoke-test.drawio';

createDiagram(path);
const a = addNode(path, { label: 'Start', x: 40, y: 40 });
const b = addNode(path, { label: 'End', x: 280, y: 40, style: 'rounded=1;fillColor=#dae8fc;' });
const e = addEdge(path, { source: a, target: b, label: 'next' });

let cells = readGraph(path);
assert.equal(cells.length, 3, 'expected 2 nodes + 1 edge');
assert.ok(cells.find((c) => c.id === a && c.label === 'Start'));
assert.ok(cells.find((c) => c.id === e && c.source === a && c.target === b));

updateCell(path, b, { label: 'Done', x: 300 });
cells = readGraph(path);
assert.equal(cells.find((c) => c.id === b)?.label, 'Done');
assert.equal(cells.find((c) => c.id === b)?.geometry?.x, 300);

const removed = deleteCell(path, a);
assert.equal(removed, 2, 'deleting node a should also remove the edge touching it');
cells = readGraph(path);
assert.equal(cells.length, 1);

console.log('OK — all assertions passed. File at', path);
