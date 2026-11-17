import test from 'node:test';
import assert from 'node:assert/strict';
import { commandLabel, sandboxLabel } from '../src/shared/pip-sandbox-label.js';

// A sandbox row used to read "exec · done" and nothing else. These are the words a person would use for the command.
test('an exec row says what the command does', () => {
  assert.equal(commandLabel('browse navigate https://example.com/path?q=1'), 'open example.com');
  assert.equal(commandLabel('browse snapshot --tab 1959072019'), 'read the page');
  assert.equal(commandLabel('browse screenshot --tab 3'), 'take a screenshot');
  assert.equal(commandLabel('browse tabs'), 'check the browser tabs');
  assert.equal(commandLabel('browse click e12 --tab 3'), 'use the browser');
  assert.equal(commandLabel('python3 -c "print(6*7)"'), 'run Python');
  assert.equal(commandLabel('pip install pandas'), 'install a Python package');
  assert.equal(commandLabel('ls -la /workspace'), 'list files');
  assert.equal(commandLabel('cat /workspace/notes.txt'), 'read notes.txt');
  assert.equal(commandLabel('grep -r budget .'), 'search files');
  assert.equal(commandLabel('curl -fsSL https://api.example.com/v1/x'), 'fetch api.example.com');
  assert.equal(commandLabel('git status'), 'run git status');
  assert.equal(commandLabel('sqlite3 app.db ".tables"'), 'query a database');
  assert.equal(commandLabel('unzip -q app.zip'), 'unpack an archive');
});

test('a chain is named by the step whose result the person sees', () => {
  assert.equal(commandLabel('cd /tmp && python3 report.py'), 'run Python');
  assert.equal(commandLabel('cd /tmp && npm install left-pad'), 'install a package');
  assert.equal(commandLabel('cd /tmp; ls'), 'list files');
});

test('an unknown command keeps a short, literal excerpt instead of pretending', () => {
  assert.equal(commandLabel('make build'), 'run “make build”');
  const long = commandLabel('some-long-program --with a very long argument that will not fit in one activity row at all');
  assert.ok(long.startsWith('run “') && long.endsWith('”'));
  assert.ok(long.length <= 78, 'the row stays one line');
  assert.equal(commandLabel(''), 'run a command');
  assert.equal(commandLabel(undefined), 'run a command');
});

test('the file tools name the file, not the tool', () => {
  assert.equal(sandboxLabel('read', { path: '/workspace/p1/notes.txt' }), 'read notes.txt');
  assert.equal(sandboxLabel('write', { path: '/workspace/p1/report.csv' }), 'write report.csv');
  assert.equal(sandboxLabel('edit', { path: '/workspace/p1/app.py' }), 'edit app.py');
  assert.equal(sandboxLabel('apply_patch', { input: '*** Begin Patch' }), 'edit files');
  assert.equal(sandboxLabel('ls', { path: '/workspace' }), 'list files');
  assert.equal(sandboxLabel('search_notes', { query: 'car' }), '', 'Pocket tools keep their own labels');
});
