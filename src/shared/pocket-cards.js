// What Pip may draw inside a reply: a subset of Pocket's surface catalog (src/app/surface/catalog.ts), described
// for the model. Pip draws with one tool, show_card (pip-sdk-tools.js, src/shared/pocket-card-tool.js); the chat,
// server runs and routines all use these texts, and src/app/surface/cards.test.tsx checks every component and prop
// named here against the real catalog, so what the model is told cannot drift from what the app can render.

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

/** show_card's description: what can be drawn. The model reads it with the tool, not in the system prompt. */
export const CARD_TOOL_DESCRIPTION = 'Draw a picture at this point of your reply: readings, a chart, a table, a schedule, choices, the person\'s tasks. '
  + 'elements is a flat list; each has an id, a type, its props and the ids of its children. root is the id of the top element: a single element, or a Stack that lists the others as children. Only Stack, Grid and Card hold children. '
  + 'Components: ' + list + '. Tone is one of ' + TONES.join(', ') + '. '
  + 'A Button acts through on: {"press":{"action":"askPip","params":{"prompt":"…"}}}. Actions: ' + actions + '. '
  + 'The result says whether the card was drawn and gives its id; if it names problems, correct them and call show_card again.';

/** update_card's description. */
export const CARD_UPDATE_DESCRIPTION = 'Change a card that is already in this chat, in this reply or an earlier one, where it stands: a figure that moved, a row to add, a mistake to correct. '
  + 'id is the card\'s id, from show_card\'s result or from a "[card <id> …]" record in an earlier reply. root and elements are the whole new card, in the same form as show_card: the old card is replaced, not merged. '
  + 'The person sees the card change in place, marked with the time. Use this instead of drawing the same card again.';

/** When and how Pip draws, appended to its system prompt. What can be drawn is in show_card's own description. */
export const CARDS_PROMPT = 'Pocket can draw parts of a reply as a picture: readings, charts, tables, a schedule, choices, the person\'s tasks. '
  + 'The only way to draw is the show_card tool: write the sentence a picture illustrates, call show_card right there, then go on writing after it. A reply may have up to four cards, each where it belongs, not collected at the end. '
  + 'Never write a card, JSON or a fenced block into your answer text; text like that is shown as text, not drawn. '
  + 'Figures you researched belong in a Chart or Table: put the real values you read (every point, in order), say the unit and the period, and give the source with its URL. '
  + 'For long ranges keep the shape with at most 60 points (weekly or monthly values, as the source reports them); compare places or groups with series. '
  + 'Never invent, estimate or fill in numbers; if a source gives only some points, chart only those and say so in the note. '
  + 'Show tasks and thoughts with TaskList or ThoughtList instead of retyping them. '
  + 'Every fact appears once: what the prose says needs no tile, and a Hero is not repeated by a Metric. Short labels, no emoji. Skip pictures when plain prose is enough. '
  + 'A card stays alive: when figures in a card that is already in this chat change, or it needs a correction, change that card with update_card and its id instead of drawing a second one. '
  + 'When the person asks to change, correct or add to something a card in this chat shows, call update_card; describing the change in words does not change the card. '
  + 'A message that ends with "[about card <id>]" is about that card: change it with update_card and that id. '
  + 'Earlier replies show "[card <id> drawn here with show_card: …]" where a card was; that line is a record of what the person saw, never something to write yourself.';
