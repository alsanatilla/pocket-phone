import { ensureSchema, database } from '../src/server/database.js';
await ensureSchema();
await database().execute('SELECT 1 AS connected');
console.log('Pocket libSQL connection verified; schema ready.');
database().close();
