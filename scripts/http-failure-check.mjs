// Run: node scripts/http-failure-check.mjs
// HTTP response conversion only; no app configuration, database or requests.
import assert from 'node:assert/strict';
import { APIError } from 'better-auth/api';
import { failure } from '../src/server/http.js';

const originalLog = console.error, logs = [];
console.error = (...values) => logs.push(values);
try {
  const cases = [
    [new APIError('UNAUTHORIZED', { message: 'Sign in to Pocket.' }), 401, 'Sign in to Pocket.'],
    [new APIError('FORBIDDEN', { message: 'Editing is not allowed.' }), 403, 'Editing is not allowed.'],
    [new APIError('TOO_MANY_REQUESTS', { message: 'Too many requests. Please try again later.' }), 429, 'Too many requests. Please try again later.'],
    [{ status: 409, message: 'Account changed.' }, 409, 'Account changed.'],
    [{ statusCode: 422, status: 'UNPROCESSABLE_ENTITY', message: 'Check the input.' }, 422, 'Check the input.'],
    [{ statusCode: 429, status: 400, message: 'Slow down.' }, 429, 'Slow down.'],
    [{ statusCode: 700, status: 403, message: 'Forbidden.' }, 403, 'Forbidden.'],
    [{ status: 400 }, 400, 'Request failed.'],
  ];
  for (const [error, status, message] of cases) {
    const response = failure(error);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: message });
  }
  assert.equal(logs.length, 0, 'Client errors do not enter server failure logs.');
  for (const error of [
    null, undefined, new Error('Private database connection string'),
    new APIError('INTERNAL_SERVER_ERROR', { message: 'Private adapter details' }),
    { status: 'FORBIDDEN', message: 'No numeric HTTP status' },
    { statusCode: '429', status: 'TOO_MANY_REQUESTS' },
    { status: 200 }, { status: 399 }, { status: 600 },
    { status: NaN }, { status: Infinity }, { status: 400.5 },
  ]) {
    const response = failure(error);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Pocket storage is unavailable. Try again.' });
  }
  assert.equal(logs.every(values => values.length === 2 && values[0] === 'Pocket API failed:'), true);
  assert.equal(logs.flat().some(value => /Private|connection string|adapter details/.test(String(value))), false);
} finally { console.error = originalLog; }
console.log('HTTP failure checks passed: BetterAuth symbolic errors, numeric status bounds, JSON responses and private server errors.');
