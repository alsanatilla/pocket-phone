// What Pip may draw inside a reply: a subset of Pocket's surface catalog (src/app/surface/catalog.ts), described
// for the model. The chat (pip-core.js), server runs and routines (pip-background.js) all use this one text, and
// src/app/surface/cards.test.ts checks every component and prop named here against the real catalog, so the
// prompt cannot drift from what the app can render.

export const TONES = ['accent', 'movement', 'calendar', 'thought', 'warning', 'muted'];

/** Component → [props, what it is for]. Props are listed in the order the model should think about them. */
export const CARD_COMPONENTS = {
  Stack: [['direction', 'gap'], 'vertical (default) or horizontal group; gap sm|md|lg'],
  Grid: [['columns', 'gap'], 'tiles side by side; columns 2 on a phone, 3–4 on wide screens'],
  Card: [['title', 'description'], 'a titled box around related elements'],
  Heading: [['text', 'level'], 'a heading, level h2|h3'],
  Text: [['text', 'variant'], 'a paragraph; variant body|muted|caption'],
  Badge: [['text', 'variant'], 'a short status label'],
  Separator: [[], 'a thin divider'],
  Progress: [['value', 'label'], 'a progress bar, value 0–100'],
  Alert: [['title', 'message', 'type'], 'a callout for one thing that must not be missed'],
  Accordion: [['items'], 'folded sections, items [{title, content}]'],
  Hero: [['eyebrow', 'value', 'unit', 'caption', 'tone'], 'one huge reading or phrase at the top; at most one'],
  Metric: [['label', 'value', 'unit', 'hint', 'tone'], 'a compact reading tile; put 2 or 4 in a Grid'],
  Gauge: [['label', 'value', 'caption', 'tone'], 'a ring for a 0–100 score'],
  Chart: [['kind', 'title', 'data', 'unit', 'tone'], 'a series over time; kind area|bar|line; data [{label, value}] in order'],
  Timeline: [['title', 'items'], 'a schedule or the steps of a plan; items [{time, title, detail}]'],
  TaskList: [['title', 'source', 'limit'], "the person's real tasks, live and checkable; source due|open|chosen"],
  ThoughtList: [['title', 'source', 'limit'], "the person's parked thoughts, live; source ready|open"],
  Button: [['label', 'variant'], 'a choice; bind on.press to an action; variant primary|secondary'],
};

/** The actions a card may bind, with their params. */
export const CARD_ACTIONS = {
  askPip: ['prompt', 'send this prompt to Pip as the next message (for choices and follow-ups)'],
  open: ['to', 'open an area: /today, /notes, /pip, /tasks, /thoughts, /calendar, /clock, /movement, /gym, /travel, /brief'],
  completeTask: ['uid', 'mark one task done (use a uid you read)'],
  parkThought: ['text', 'park a thought for later'],
};

const list = Object.entries(CARD_COMPONENTS).map(([name, [props, use]]) => `${name}(${props.join(', ')}): ${use}`).join('; ');
const actions = Object.entries(CARD_ACTIONS).map(([name, [param, use]]) => `${name}{${param}}: ${use}`).join('; ');

/** The instruction appended to Pip's system prompt. */
export const CARDS_PROMPT = 'When a reply is easier to take in as a picture than as prose (a trend, a few readings, a schedule, a set of choices, the person\'s tasks), '
  + 'put one fenced block tagged pocket after the prose. Inside it write JSON Lines: one json-render patch per line, so it draws while you write. '
  + 'Start with {"op":"add","path":"/root","value":"main"}, then add each element as {"op":"add","path":"/elements/<id>","value":{"type":"<Component>","props":{…},"children":[…]}}. '
  + 'Every element needs a children array, empty when it has none; only Stack, Grid and Card hold children. '
  + 'Components: ' + list + '. Tone is one of ' + TONES.join(', ') + '. '
  + 'A Button acts through "on" beside "props": {"on":{"press":{"action":"askPip","params":{"prompt":"…"}}}}. Actions: ' + actions + '. '
  + 'Use values you actually read or were given; never invent numbers. Show tasks and thoughts with TaskList or ThoughtList instead of retyping them. '
  + 'Every fact appears once: what the prose says needs no tile, and a Hero is not repeated by a Metric. At most 12 elements, short labels, no emoji. Skip the block when plain prose is enough.';
