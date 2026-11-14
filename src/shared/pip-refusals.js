// What Pocket's server answers when it will not start a Pip reply. A refused submit carries these as its error, and a
// queued message that meets the same when its turn comes ends with them as its turn's error, so a client can tell a
// refusal from a failure by the words alone (the new app says them in its own terms: src/app/features/pip/account.ts).

/** No key for the chat's endpoint in the account's vault, and no matching key of "Pip on its own". */
export const NOT_SET_UP = 'Pip on the server is not set up for the selected provider. Connect that provider in Pip settings.';
/** The run would use "Pip on its own"'s key, whose daily token limit is spent. */
export const NO_TOKENS = 'Today’s token limit for Pip on the server is used up.';
