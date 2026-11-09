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
  Chart: [['kind', 'title', 'data', 'series', 'unit', 'tone', 'note', 'source'], 'numbers over time or across categories; kind area|bar|line; data [{label, value}] for one series, or series [{name, data}] (up to 5, same labels) to compare; note is one line on period or definition; source {title, url}'],
  Table: [['title', 'columns', 'rows', 'note', 'source'], 'figures or facts to read row by row; columns [names], rows [[cells]] in column order, up to 40 rows'],
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
export const CARDS_PROMPT = 'Pocket can draw parts of a reply as a picture: readings, charts, tables, a schedule, choices, the person\'s tasks. '
  + 'Write a fenced block tagged pocket exactly where the picture belongs in the prose, between paragraphs, not collected at the end; a reply may have up to four, each right after the sentence it illustrates. '
  + 'Inside each block write JSON Lines: one json-render patch per line, so it draws while you write. '
  + 'Start with {"op":"add","path":"/root","value":"main"}, then add each element as {"op":"add","path":"/elements/<id>","value":{"type":"<Component>","props":{…},"children":[…]}}. '
  + 'Ids only need to be unique within their block. Every element needs a children array, empty when it has none; only Stack, Grid and Card hold children. '
  + 'Components: ' + list + '. Tone is one of ' + TONES.join(', ') + '. '
  + 'A Button acts through "on" beside "props": {"on":{"press":{"action":"askPip","params":{"prompt":"…"}}}}. Actions: ' + actions + '. '
  + 'Figures you researched belong in a Chart or Table: put the real values you read (every point, in order), say the unit and the period, and give the source with its URL. '
  + 'For long ranges keep the shape with at most 60 points (weekly or monthly values, as the source reports them); compare places or groups with series. '
  + 'Never invent, estimate or fill in numbers; if a source gives only some points, chart only those and say so in the note. '
  + 'Show tasks and thoughts with TaskList or ThoughtList instead of retyping them. '
  + 'Every fact appears once: what the prose says needs no tile, and a Hero is not repeated by a Metric. Short labels, no emoji. Skip pictures when plain prose is enough. '
  + 'The format above is the only card format: earlier replies may still hold cards written in an older shape, and that shape is retired. Never copy an earlier card; write every card now as the json-render patches described here.';
