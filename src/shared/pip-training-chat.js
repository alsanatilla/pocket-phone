// A training chat uses the account's routine key and permissions; ordinary chats keep their own settings.
export const trainingChatRoutine = uid => /^pip-training-([A-Za-z0-9_-]{1,40})-\d{4}-\d{2}$/.exec(uid || '')?.[1] || '';
