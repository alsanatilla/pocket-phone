import * as trips from './travel-store.js';
import * as cloud from './cloud.js';
import { activeAccount } from './workspace-storage.js';

export const INVITE_RESUME = 'pocket:travel-invite';
const tokenPattern = /^[A-Za-z0-9_-]{30,100}$/;
const links = new Map();
const roleName = role => ({ owner: 'owner', editor: 'can edit', viewer: 'view only' })[role] || 'local';
const path = uid => '/travel/' + encodeURIComponent(uid);
function node(tag, attrs = {}, ...children) {
  const item = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'text') item.textContent = String(value);
    else if (key === 'class') item.className = value;
    else if (key.startsWith('on')) item.addEventListener(key.slice(2), value);
    else item.setAttribute(key, String(value));
  }
  item.append(...children.flat().filter(value => value != null));
  return item;
}
const button = (text, run, attrs = {}) => node('button', { type: 'button', text, onclick: run, ...attrs });
const meta = text => node('p', { class: 'meta muted', text });
async function run(control, api, task) {
  control.disabled = true;
  try { return await task(); } catch (error) { api.say(error.message); }
  finally { if (control.isConnected) control.disabled = false; }
}

export function syncLabel(uid) {
  const status = trips.readStatus(), record = uid && trips.getRecord(uid);
  const pending = uid ? record?.pending : status.pending;
  if (record?.conflict) return 'needs review';
  if (!navigator.onLine) return pending ? 'offline · changes waiting' : 'offline';
  if (!cloud.connected()) return 'saved on this device';
  if (status.state === 'error') return 'sync failed';
  if (pending) return 'changes waiting';
  if (status.state === 'syncing') return 'syncing…';
  return status.last ? 'live · ' + new Date(status.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'connecting…';
}

export function controls(host, trip, api) {
  const record = trips.getRecord(trip.uid);
  const state = node('span', { class: 'travel-live-state', 'data-travel-state': trip.uid, role: 'status', text: syncLabel(trip.uid) });
  const actions = node('div', { class: 'travel-share-controls' },
    button('‹ trips', () => api.go('/travel')), state,
    button(record?.members?.length > 1 ? 'sharing · ' + record.members.length : 'share trip', () => api.go(path(trip.uid) + '/share')));
  if (record?.role === 'viewer') actions.append(node('span', { class: 'meta muted', text: 'view only' }));
  if (record?.conflict) actions.append(button('review changes', () => api.go(path(trip.uid) + '/conflict'), { class: 'warn' }));
  host.append(actions);
}

export function mountSharing(host, trip, api) {
  host.append(button('‹ trip', () => api.go(path(trip.uid)), { class: 'travel-back' }));
  api.title(host, 'sharing', trip.title, 'travel');
  if (!cloud.connected()) {
    host.append(button('sign in to share', () => api.go('/account'), { class: 'travel-commit' }));
    return () => {};
  }
  const body = node('div', { class: 'travel-sharing' }), members = node('div'), invitations = node('div');
  const email = node('input', { type: 'email', placeholder: 'Email · optional', 'aria-label': 'Invite email', maxlength: 254, autocomplete: 'email' });
  const role = node('select', { 'aria-label': 'Invite permission' }, node('option', { value: 'editor', text: 'can edit' }), node('option', { value: 'viewer', text: 'view only' }));
  const linkBox = node('div', { class: 'travel-invite-link' });
  const key = activeAccount() + ':' + trip.uid;
  function showLink(url) {
    linkBox.replaceChildren();
    if (!url) return;
    const input = node('input', { type: 'url', readonly: 'readonly', 'aria-label': 'Trip invitation link' }); input.value = url;
    const copy = button('copy link', async () => {
      try { await navigator.clipboard.writeText(url); api.say('Link copied.'); }
      catch { input.focus(); input.select(); api.say('Select and copy this link.'); }
    });
    linkBox.append(input, copy);
  }
  showLink(links.get(key));
  const invite = node('button', { type: 'submit', class: 'travel-commit', text: 'create invite link' });
  const form = node('form', { class: 'travel-invite-form', onsubmit: async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    await run(invite, api, async () => {
      const result = await trips.inviteTrip(trip.uid, email.value.trim(), role.value);
      const url = new URL('/', location.origin); url.hash = '/travel/join/' + result.token;
      links.set(key, url.href); showLink(url.href); draw();
    });
  } }, email, role, invite);
  const leave = button('leave trip', async () => {
    if (!await api.confirm('Leave ' + trip.title + '?', 'leave')) return;
    await run(leave, api, async () => { await trips.leaveTrip(trip.uid); api.go('/travel'); });
  }, { class: 'travel-delete' });
  function draw() {
    if (!host.isConnected) return;
    const record = trips.getRecord(trip.uid);
    if (!record) { api.go('/travel'); return; }
    members.replaceChildren(node('h2', { class: 'section', text: 'people' }), ...(record.members || []).map(member => {
      const row = node('div', { class: 'travel-person-row' }, node('div', {}, node('span', { text: member.name || member.email || 'Pocket member' }), meta(roleName(member.role) + (member.userId === activeAccount() ? ' · you' : ''))));
      if (record.role === 'owner' && member.role !== 'owner') {
        const remove = button('remove', async () => {
          if (!await api.confirm('Remove ' + (member.name || member.email) + ' from this trip?', 'remove')) return;
          await run(remove, api, async () => { await trips.removeMember(trip.uid, member.userId); draw(); });
        }); row.append(remove);
      }
      return row;
    }));
    const owner = record.role === 'owner'; form.hidden = !owner; linkBox.hidden = !owner; leave.hidden = owner;
    invitations.replaceChildren();
    if (owner && record.invites?.length) invitations.append(node('h2', { class: 'section', text: 'invites' }), ...record.invites.map(item => {
      const row = node('div', { class: 'travel-person-row' }, node('div', {}, node('span', { text: item.email || 'Invite link' }), meta(roleName(item.role) + ' · expires ' + new Date(item.expiresAt).toLocaleDateString())));
      const revoke = button('revoke', () => run(revoke, api, async () => { await trips.revokeInvite(trip.uid, item.id); links.delete(key); showLink(null); draw(); }));
      row.append(revoke); return row;
    }));
  }
  body.append(members, form, linkBox, invitations, leave); host.append(body); draw();
  return trips.subscribe(draw);
}

export async function mountInvitation(host, token, api) {
  api.title(host, 'join trip', '', 'travel');
  if (!tokenPattern.test(token || '')) { host.append(meta('This invitation is invalid.')); return; }
  globalThis.sessionStorage.setItem(INVITE_RESUME, token);
  if (!cloud.connected()) {
    host.append(button('sign in to join', () => api.go('/account'), { class: 'travel-commit' }), button('create account', () => api.go('/account/new')));
    return;
  }
  const pending = meta('Opening invite…'); host.append(pending);
  try {
    const invite = await trips.previewInvite(token); if (!host.isConnected) return;
    pending.remove();
    host.append(node('h2', { class: 'travel-editor-title', text: invite.title }), meta('From ' + (invite.inviter?.name || 'a Pocket member') + ' · ' + roleName(invite.role)));
    if (invite.eligible === false) { host.append(meta(invite.reason || 'This invite belongs to another account.')); return; }
    const accept = button('join trip', () => run(accept, api, async () => {
      const record = await trips.acceptInvite(token);
      globalThis.sessionStorage.removeItem(INVITE_RESUME);
      api.go(path(record.uid)); api.say('Trip joined.');
    }), { class: 'travel-commit' });
    host.append(accept, button('cancel', () => { globalThis.sessionStorage.removeItem(INVITE_RESUME); api.go('/travel'); }));
  } catch (error) { if (host.isConnected) pending.textContent = error.message; }
}

function fieldLabel(value) {
  if (Array.isArray(value)) return value.join(' › ');
  return String(value || 'trip').replace(/[./]/g, ' › ');
}
function atPath(value, path) {
  for (const match of String(path).matchAll(/([^.[\]]+)|\[([^\]]+)\]/g)) {
    if (match[2]) value = Array.isArray(value) ? value.find(item => item.uid === match[2]) : undefined;
    else if (match[1] === 'order' && Array.isArray(value)) value = value.map(item => item.place || item.name || item.title || item.text || item.uid);
    else value = value?.[match[1]];
  }
  return value;
}
function readablePath(path, local, remote) {
  return fieldLabel(String(path).replace(/\[([^\]]+)\]/g, (whole, uid) => {
    const find = value => [...(value?.stops || []), ...(value?.moments || []), ...(value?.stops || []).flatMap(stop => [...stop.stays, ...stop.activities, ...stop.moments])].find(item => item.uid === uid);
    const entity = find(local) || find(remote);
    return ' › ' + (entity?.place || entity?.name || entity?.title || entity?.text || uid);
  }));
}
export function mountConflict(host, trip, api) {
  host.append(button('‹ trip', () => api.go(path(trip.uid)), { class: 'travel-back' }));
  api.title(host, 'review changes', trip.title, 'travel');
  const conflict = trips.getRecord(trip.uid)?.conflict;
  if (!conflict) { host.append(meta('All changes are synced.')); return; }
  if (conflict.reason) host.append(meta(conflict.reason));
  const conflicts = conflict.conflicts || conflict.paths || [];
  host.append(node('div', { class: 'travel-conflicts' }, ...conflicts.map(item => {
    const row = node('div', { class: 'travel-conflict-row' });
    const path = item.path || item;
    row.append(node('strong', { text: readablePath(path, conflict.local, conflict.remote) }));
    if (path !== 'limits' && path !== 'deleted') {
      const display = value => value == null ? 'removed' : typeof value === 'string' ? value : JSON.stringify(value);
      row.append(meta('Yours: ' + display(typeof item === 'object' ? item.local ?? item.incoming : atPath(conflict.local, path))), meta('Shared: ' + display(typeof item === 'object' ? item.remote ?? item.current : atPath(conflict.remote, path))));
    }
    return row;
  })));
  for (const [label, choice] of [[conflict.intent === 'delete' ? 'delete updated trip' : 'keep my changes', 'local'], [conflict.intent === 'delete' ? 'keep shared trip' : 'use shared changes', 'remote']]) {
    const pick = button(label, async () => {
      const question = conflict.intent === 'delete' ? (choice === 'local' ? 'Delete this updated trip for everyone?' : 'Cancel your deletion and keep the shared trip?') : choice === 'local' ? 'Use your version of the conflicting details?' : 'Use the shared version of the conflicting details?';
      if (!await api.confirm(question, conflict.intent === 'delete' && choice === 'local' ? 'delete' : 'apply')) return;
      await run(pick, api, async () => { await trips.resolveConflict(trip.uid, choice); api.go(path(trip.uid)); });
    }, { class: 'travel-commit' }); host.append(pick);
  }
}
