// The one big chat with Pip: a chain of ordinary chats marked `home`, whose newest segment takes the next message.
// This file only decides which segment that is; showing the segments joined as one page comes later.

import { chats, createChat, listChats } from "./chats.ts";
import type { Chat } from "./chats.ts";
import type { PipConfig } from "../../client/pip-core.js";
import { HOME_TITLE, currentHome, homeFull, homeSegments } from "../../shared/pip-home.js";

/** A new segment with the home marks; `config` keeps the model the person chose. */
function newSegment(config?: PipConfig): Chat {
  const created = createChat(config);
  return chats.update(created.uid, chat => { chat.home = true; chat.title = HOME_TITLE; chat.titled = true; });
}

/** The home segments, oldest first. */
export function homeChats(): Chat[] { return homeSegments(listChats()); }

/** The current home segment, created when the account has none. */
export function homeChat(): Chat { return currentHome(homeChats()) ?? newSegment(); }

/** The segment the next message goes to: the current one, or a new one when it is full. */
export function homeForSend(): Chat {
  const current = homeChat();
  return homeFull(current) ? newSegment(current.config) : current;
}

/** Whether a chat is a segment of the one big chat. */
export function isHome(chat: Chat): boolean { return chat.home === true; }
