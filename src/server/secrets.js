import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

function key() {
  const source = process.env.POCKET_ENCRYPTION_SECRET || process.env.BETTER_AUTH_SECRET || process.env.TURSO_AUTH_TOKEN;
  if (!source) throw new Error('Pocket encryption is not configured.');
  return createHash('sha256').update('pocket-integrations-v1:' + source).digest();
}
export function seal(userId, value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
}
export function open(userId, value) {
  const data = JSON.parse(value), decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(data.iv, 'base64'));
  decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.data, 'base64')), decipher.final()]).toString('utf8'));
}
export const jobSecret = () => {
  if (!process.env.TURSO_AUTH_TOKEN) throw new Error('Pocket jobs are not configured.');
  return createHash('sha256').update('pocket-coros-job-v1:' + process.env.TURSO_AUTH_TOKEN).digest('hex');
};
export function authorizedJob(request) {
  const provided = Buffer.from(request.headers.get('authorization') || '');
  return [process.env.CRON_SECRET, jobSecret()].filter(Boolean).some(secret => {
    const expected = Buffer.from('Bearer ' + secret);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}
