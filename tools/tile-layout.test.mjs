import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pack, cellBox, dropIndex, snapSize, moved } from '../src/client/tile-layout.js';

// The same cases run against TileLayout.java, so both boards place, move and resize tiles alike.
const cases = JSON.parse(readFileSync(new URL('./fixtures/tile-layout-cases.json', import.meta.url), 'utf8'));

for (const item of cases.pack) test('packing: ' + item.name, () => {
  assert.deepEqual(pack(item.sizes, item.columns).map(cell => [cell.col, cell.row]), item.cells);
});

for (const item of cases.drop) test('dragging: ' + item.name, () => {
  const { columns, ...metrics } = cases.dropMetrics;
  assert.equal(dropIndex({ others: item.others, size: item.size, center: { x: item.center[0], y: item.center[1] }, columns, metrics, current: item.current }), item.index);
});

for (const item of cases.snap) test(`resizing to ${item.cols}x${item.rows} cells snaps to ${item.size}`, () => {
  assert.equal(snapSize(item.cols, item.rows), item.size);
});

test('a cell box covers its columns and the gaps between them', () => {
  assert.deepEqual(cellBox({ col: 1, row: 2, cols: 2, rows: 2 }, { unit: 80, rowUnit: 90, gap: 8 }), { left: 88, top: 196, width: 168, height: 188 });
});

test('a wide tile is never placed past the board, even on a narrow one', () => {
  assert.deepEqual(pack(['wide', 'small'], 2).map(cell => [cell.col, cell.row, cell.cols]), [[0, 0, 2], [0, 2, 1]]);
});

test('moving an item keeps every other item in order', () => {
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moved(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moved(['a', 'b'], 0, 9), ['b', 'a']);
});
