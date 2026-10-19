import { readDocuments } from './workspace.js';
import { corosState, corosTool, corosCatalog } from './coros.js';
import { EMPTY } from '../shared/workspace.js';
import { recordSource } from '../client/pip-tools.js';

/**
 * Where a server-run tool reads the account: the synced copy of the workspace, the account's own COROS
 * connection, and no per-tab secrets. Calendar appointments come from the synced agenda unless the caller
 * keeps them on the device (a routine, which tells the model they are unavailable).
 */
export async function serverRecordSource(userId, { calendar = true } = {}) {
  const documents = await readDocuments(userId), coros = await corosState(userId).catch(() => null);
  const live = async run => {
    try { return { value: await run() }; }
    catch (error) { return { failed: { error: error.status === 422 ? 'coros_refused' : 'coros_unavailable', message: String(error.message || 'COROS is unavailable.').slice(0, 800) } }; }
  };
  const appointments = () => (documents['agenda.json']?.value.events || []).filter(item => !item.deleted);
  return recordSource(name => documents[name]?.value || EMPTY[name](), {
    ...(calendar ? { appointments, appointment: id => appointments().find(item => item.uid === id) || null } : { appointments: () => [], appointment: () => null }),
    corosCache: () => ({ cockpit: coros?.data?.cockpit || null, activities: coros?.data?.activities || null }),
    coros: (action, body) => action === 'tool' ? live(() => corosTool(userId, body.name, body.arguments)) : action === 'catalog' ? live(() => corosCatalog(userId, body.names))
      : Promise.resolve({ failed: { error: 'coros_unavailable', message: 'This COROS request is unavailable here.' } })
  });
}
