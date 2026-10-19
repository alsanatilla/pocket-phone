import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, verify } from 'node:crypto';

process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { encrypt, vapid, vapidKeys, push } = await import('../src/server/web-push.js');
const bytes = value => Buffer.from(value.replace(/\s+/g, ''), 'base64url');

// RFC 8291, Section 5 and Appendix A: the worked example, byte for byte.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ'
};

test('a message is encrypted exactly as RFC 8291’s worked example', () => {
  const body = encrypt(RFC.plaintext, { p256dh: RFC.uaPublic.replace(/\s+/g, ''), auth: RFC.auth }, { salt: bytes(RFC.salt), serverKey: bytes(RFC.asPrivate) });
  assert.equal(body.subarray(0, 86).toString('base64url'), bytes(RFC.header).toString('base64url'), 'salt, record size and key id');
  assert.equal(body.subarray(86).toString('base64url'), bytes(RFC.ciphertext).toString('base64url'), 'AES-128-GCM output with the padding delimiter');
});

test('each message gets its own salt and server key', () => {
  const browser = createECDH('prime256v1'); browser.generateKeys();
  const keys = { p256dh: browser.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') };
  const one = encrypt('same', keys), two = encrypt('same', keys);
  assert.notEqual(one.toString('hex'), two.toString('hex'));
  assert.throws(() => encrypt('x', { p256dh: 'AAAA', auth: keys.auth }), /unusable keys/);
});

test('the VAPID token names the push service, expires within a day and verifies with the published key', () => {
  const keys = vapidKeys(), now = Date.UTC(2026, 9, 19, 12);
  assert.equal(bytes(keys.publicKey).length, 65); assert.equal(bytes(keys.publicKey)[0], 4);
  assert.equal(vapidKeys().publicKey, keys.publicKey, 'the same secret gives the same key, so subscriptions survive a redeploy');
  const header = vapid('https://fcm.googleapis.com/fcm/send/abc', { now, subject: 'https://pocket.example' });
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, keys.publicKey);
  const [head, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const body = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(body.aud, 'https://fcm.googleapis.com'); assert.equal(body.sub, 'https://pocket.example');
  assert.ok(body.exp > now / 1000 && body.exp <= now / 1000 + 24 * 3600);
  const point = bytes(keys.publicKey);
  const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
  assert.ok(verify('sha256', Buffer.from(head + '.' + claims), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});

test('a push is one encrypted POST, and a subscription the browser dropped is reported gone', async () => {
  const browser = createECDH('prime256v1'); browser.generateKeys();
  const subscription = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc', keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } };
  const sent = [];
  const answer = status => async (url, options) => { sent.push({ url, options }); return new Response(null, { status }); };
  assert.equal(await push(subscription, { title: 'Pip' }, { fetcher: answer(201), topic: 'pip-chat-1', ttl: 600 }), 'sent');
  const { url, options } = sent[0];
  assert.equal(url, subscription.endpoint); assert.equal(options.method, 'POST');
  assert.equal(options.headers['content-encoding'], 'aes128gcm'); assert.equal(options.headers.ttl, '600');
  assert.match(options.headers.authorization, /^vapid t=.+, k=/);
  assert.match(options.headers.topic, /^[A-Za-z0-9_-]{1,32}$/, 'a topic the push service accepts');
  assert.ok(!options.body.includes(Buffer.from('Pip')), 'the title travels encrypted');
  assert.equal(await push(subscription, { title: 'Pip' }, { fetcher: answer(410) }), 'gone');
  assert.equal(await push(subscription, { title: 'Pip' }, { fetcher: answer(404) }), 'gone');
  assert.equal(await push(subscription, { title: 'Pip' }, { fetcher: answer(500) }), 'failed');
  assert.equal(await push(subscription, { title: 'Pip' }, { fetcher: async () => { throw new Error('offline'); } }), 'failed');
});
