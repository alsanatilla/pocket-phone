import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

// Web Push on node:crypto alone: a message is encrypted for one browser (RFC 8291, aes128gcm) and the request is
// signed with the server's VAPID key (RFC 8292), so only that browser can read it and only this server can send it.
// The push service sees neither the text nor the account.
const P256_ORDER = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const RECORD = 4096, SUBJECT = () => process.env.BETTER_AUTH_URL || 'https://pocket-phone.vercel.app';
const b64 = value => Buffer.from(value).toString('base64url');
const decode = value => Buffer.from(String(value || ''), 'base64url');

let derived = null;
/**
 * The VAPID key pair. It is derived from Pocket's server secret, so it needs no setting of its own and stays the
 * same across deploys. Rotating that secret rotates this key; browsers then subscribe again with the new one.
 */
export function vapidKeys() {
  const source = process.env.POCKET_ENCRYPTION_SECRET || process.env.BETTER_AUTH_SECRET || process.env.TURSO_AUTH_TOKEN;
  if (!source) throw new Error('Pocket notifications are not configured.');
  const id = createHash('sha256').update(source).digest('hex');
  if (derived?.id === id) return derived;
  for (let round = 0; ; round++) {
    // A P-256 private key is any number from 1 to the group order; a hash outside that range is skipped.
    const secret = createHmac('sha256', source).update('pocket-web-push-vapid-v1:' + round).digest(), value = BigInt('0x' + secret.toString('hex'));
    if (value === 0n || value >= P256_ORDER) continue;
    const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(secret);
    const point = ecdh.getPublicKey();
    const privateKey = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64(secret), x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)) } });
    return derived = { id, publicKey: b64(point), privateKey };
  }
}

/** The Authorization header for one push service: a 12-hour ES256 token for its origin and the public key. */
export function vapid(endpoint, { now = Date.now(), subject = SUBJECT(), keys = vapidKeys() } = {}) {
  const head = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(head + '.' + claims), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + claims + '.' + b64(signature) + ', k=' + keys.publicKey;
}

/**
 * One aes128gcm record for the browser that owns `keys` (its p256dh point and auth secret). `salt` and `serverKey`
 * are fresh for every message; tests pass RFC 8291's to check the result byte for byte.
 */
export function encrypt(payload, keys, { salt = randomBytes(16), serverKey = null } = {}) {
  const browser = decode(keys?.p256dh), auth = decode(keys?.auth);
  if (browser.length !== 65 || browser[0] !== 4 || auth.length !== 16) throw new Error('This subscription has unusable keys.');
  const ecdh = createECDH('prime256v1');
  if (serverKey) ecdh.setPrivateKey(serverKey); else ecdh.generateKeys();
  const server = ecdh.getPublicKey(), shared = ecdh.computeSecret(browser);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), browser, server]), 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const text = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  if (text.length + 16 > RECORD) throw new Error('This notification is too large.');
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  const sealed = Buffer.concat([cipher.update(text), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(RECORD, 16); header[20] = server.length;
  return Buffer.concat([header, server, sealed]);
}

/**
 * Delivers one message to one subscription: 'sent', 'gone' when the browser dropped the subscription (it should be
 * forgotten), or 'failed'. A topic lets the push service replace an undelivered message about the same thing.
 */
export async function push(subscription, message, { fetcher = fetch, ttl = 43200, topic = '', urgency = 'normal' } = {}) {
  try {
    const body = encrypt(JSON.stringify(message), subscription.keys);
    const headers = { authorization: vapid(subscription.endpoint), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(ttl), urgency,
      ...(topic ? { topic: createHash('sha256').update(topic).digest('base64url').slice(0, 32) } : {}) };
    const response = await fetcher(subscription.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(6000) });
    return response.status === 404 || response.status === 410 ? 'gone' : response.ok ? 'sent' : 'failed';
  } catch { return 'failed'; }
}
