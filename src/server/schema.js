import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable('pocket_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false), image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
export const session = sqliteTable('pocket_session', {
  id: text('id').primaryKey(), expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(), token: text('token').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ipAddress'), userAgent: text('userAgent'), userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
});
export const account = sqliteTable('pocket_account', {
  id: text('id').primaryKey(), accountId: text('accountId').notNull(), providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }), accessToken: text('accessToken'), refreshToken: text('refreshToken'), idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }), refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope: text('scope'), password: text('password'), createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
export const verification = sqliteTable('pocket_verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(), createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
});
export const rateLimit = sqliteTable('pocket_rate_limit', {
  id: text('id').primaryKey(), key: text('key').notNull().unique(), count: integer('count').notNull(), lastRequest: integer('lastRequest').notNull(),
});
export const passkey = sqliteTable('pocket_passkey', {
  id: text('id').primaryKey(), name: text('name'), publicKey: text('publicKey').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }), credentialID: text('credentialID').notNull(),
  counter: integer('counter').notNull(), deviceType: text('deviceType').notNull(), backedUp: integer('backedUp', { mode: 'boolean' }).notNull(),
  transports: text('transports'), createdAt: integer('createdAt', { mode: 'timestamp_ms' }), aaguid: text('aaguid'),
});
export const deviceCode = sqliteTable('pocket_device_code', {
  id: text('id').primaryKey(), deviceCode: text('deviceCode').notNull().unique(), userCode: text('userCode').notNull().unique(),
  userId: text('userId'), expiresAt: integer('expiresAt', { mode: 'timestamp_ms' }).notNull(), status: text('status').notNull(),
  lastPolledAt: integer('lastPolledAt', { mode: 'timestamp_ms' }), pollingInterval: integer('pollingInterval'), clientId: text('clientId'), scope: text('scope'),
  createdAt: integer('createdAt', { mode: 'timestamp_ms' }), updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }),
});
