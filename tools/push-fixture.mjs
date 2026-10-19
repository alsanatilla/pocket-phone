import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

// The browser's side of Web Push for tests: a subscription at a push service, and reading what was pushed to it.
// Encryption itself is checked against RFC 8291 in web-push.test.mjs; this only decrypts to read the message.
export function browser(endpoint = 'https://fcm.googleapis.com/fcm/send/fixture-' + randomBytes(6).toString('hex')) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16), point = ecdh.getPublicKey();
  const subscription = { endpoint, keys: { p256dh: point.toString('base64url'), auth: auth.toString('base64url') } };
  const read = body => {
    const salt = body.subarray(0, 16), size = body[20], server = body.subarray(21, 21 + size), sealed = body.subarray(21 + size);
    const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(server), auth, Buffer.concat([Buffer.from('WebPush: info\0'), point, server]), 32));
    const decipher = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)),
      Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
    decipher.setAuthTag(sealed.subarray(-16));
    const text = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
    return JSON.parse(text.subarray(0, text.lastIndexOf(2)).toString('utf8'));
  };
  return { subscription, read };
}

/** Stands in for the push services: each push is recorded and answered with `status`. Other requests pass through. */
export function pushService(status = 201) {
  const real = globalThis.fetch, pushed = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (!/^https:\/\/(fcm\.googleapis\.com|[^/]*push\.services\.mozilla\.com|[^/]*\.notify\.windows\.com|[^/]*push\.apple\.com)\//.test(href)) return real(url, options);
    pushed.push({ endpoint: href, headers: options.headers, body: Buffer.from(options.body) });
    return new Response(null, { status });
  };
  return { pushed, restore: () => { globalThis.fetch = real; } };
}
