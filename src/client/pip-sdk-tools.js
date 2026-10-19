import { tool } from 'ai';
import { z } from 'zod';
import { COROS_ARGUMENTS, COROS_INDEX, COROS_READS, COROS_WRITES, recordProblem } from './pip-tools.js';

// The model-facing contract of every Pip tool. The AI SDK sends these schemas as JSON Schema
// and validates each call against them before it runs; tool behaviour lives in pip-tools.js.
// Loaded with the SDK, outside the initial app bundle.
const optional = (schema, description, fallback) => schema.optional().meta({ ...(description ? { description } : {}), ...(fallback === undefined ? {} : { default: fallback }) });
const text = description => optional(z.string().max(200), description);
const integer = (description, min, max, fallback) => optional(z.number().int().min(min).max(max), description, fallback);
const object = shape => z.object(shape).strict();
const search = { query: text('Words to match; empty lists recent records.'), limit: integer('Maximum results.', 1, 5, 5) };
const days = { days: integer('Calendar days ending today.', 1, 30, 7) };
const ahead = integer('Calendar days beginning today.', 1, 30, 7);
const paging = { offset: integer('Character offset; use next_offset to continue.', 0, 200000, 0), length: integer('Characters to read.', 200, 6000, 6000) };
const recordId = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/).meta({ description: 'The id returned by a Pocket search.' });
const line = z.string().min(1).max(160).regex(/^[^\r\n]+$/);
const corosArguments = (name, description) => z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= COROS_ARGUMENTS[name], 'Keep the COROS arguments under ' + COROS_ARGUMENTS[name] + ' characters.').meta({ description });
const checked = problem => (value, context) => { const message = problem(value); if (message) context.addIssue({ code: 'custom', message }); };

const DEFINITIONS = {
  update_training_preferences: ['Remember training preferences the user states in this conversation. Keep the existing brief when changing only days or pausing. When replacing the brief, retain still-valid goals, equipment and constraints; do not invent them. Put temporary soreness or fatigue in dated feedback, not permanent goals. Save before claiming to remember it. enabled pauses/resumes automatic planning only when the user asks.', object({
    brief: z.string().min(1).max(4000).optional(), trainingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    feedback: z.string().min(1).max(1000).optional(), enabled: z.boolean().optional()
  }).refine(value => Object.keys(value).length > 0, 'Supply a training preference to remember.')],
  search_notes: ['Search saved Pocket notes. All query words must match. Read a result by id for its text; drafts are excluded.', object(search)],
  read_note: ['Read a saved Pocket note in pages. Use next_offset for more text. No drafts or writes.', object({ id: recordId, ...paging })],
  search_thoughts: ['Search undecided, parked Thoughts. Thoughts are separate from Tasks. Read only; never turns an idea into an action.', object(search)],
  search_tasks: ['Search chosen Pocket tasks, including completion and due date. Read only; never edits or completes a task.', object(search)],
  read_task: ['Read a chosen Pocket task, its steps, source, due date and completion. Never edits a task.', object({ id: recordId })],
  search_calendar: ['Search saved Calendar appointments from today through the next 1–30 days. Read only.', object({ ...search, days: ahead })],
  search_pocket: ['Search Notes, Tasks, parked Thoughts and Calendar together, using only granted categories. Returns links and excerpts.', object({ query: search.query, limit: integer('Maximum results.', 1, 10, 10), days: ahead })],
  read_chat_history: ['Read this conversation\'s earlier requests, final answers, actual tool outcomes and user-approved actions. Historical results are not current facts. No other chats or provider reasoning. Source results respect current access. Use next_offset for older matches, turn_id for one reply, or event_id for serialized recorded result pages using next_result_offset. Listings contain excerpts; query searches full requests and completed answers. With turn_id, use answer_offset or request_offset to read exact text in bounded pages, including explicitly attached request snapshots; follow next_answer_offset or next_request_offset. Match offsets locate search hits beyond excerpts.', object({
    query: search.query, turn_id: recordId.optional(), event_id: text('An event_id returned by conversation memory or this tool.'),
    offset: integer('Matching reply offset, newest first.', 0, 200000, 0), limit: integer('Maximum matching replies.', 1, 5, 3),
    result_offset: integer('Recorded result character offset; use next_result_offset.', 0, 8000, 0), result_length: integer('Recorded result characters to read.', 200, 6000, 2000),
    answer_offset: integer('Completed answer offset with turn_id; use next_answer_offset or answer_match_offset.', 0, 200000),
    request_offset: integer('Original request and attached snapshot offset with turn_id; use next_request_offset or request_match_offset.', 0, 200000)
  })],
  update_plan: ['Show or update a short plan for this reply. Changes only the displayed plan; never saves Pocket records.', object({ steps: z.array(object({ text: z.string().min(1).max(160), status: z.enum(['pending', 'in_progress', 'done']) })).min(1).max(6) })],
  create_record: ['Save a new note, task or appointment in Pocket. The user reviews it first and may edit, approve or decline it; the result says whether it was saved. Appointments need when; task due is YYYY-MM-DD.', object({
    kind: z.enum(['note', 'task', 'appointment']), title: z.string().min(1).max(200), text: z.string().max(6000), due: optional(z.string().max(10)),
    steps: optional(z.array(line).max(12)), when: optional(z.string().max(40)), minutes: integer('Appointment duration in minutes.', 15, 480, 60)
  }).superRefine(checked(recordProblem))],
  change_record: ['Change an existing record: complete_task, update_task (title, due YYYY-MM-DD or empty to clear, add_steps), append_note (text) or move_appointment (when, minutes). Use ids from Pocket searches or reads. The user reviews it first and may edit, approve or decline it; the result says whether it was applied.', object({
    change: z.enum(['complete_task', 'update_task', 'append_note', 'move_appointment']), id: recordId, title: optional(z.string().min(1).max(200)), due: optional(z.string().max(10)),
    add_steps: optional(z.array(line).max(6)), text: optional(z.string().min(1).max(4000)), when: optional(z.string().max(40), 'An ISO 8601 timestamp with UTC or an offset.'),
    minutes: integer('Appointment duration in minutes.', 15, 480), reason: optional(z.string().max(300), 'One short line on why, shown in the review.')
  })],
  gym_summary: ['Read locally saved workouts and their exercise sets from the last 1–30 days. Never edits a workout.', object(days)],
  coros_summary: ['Read COROS readings already cached in Movement. Never refreshes or calls COROS. Check last_updated and stale; missing data is not a zero reading.', object(days)],
  coros_read: ['Read live data from the user\'s COROS account, in pages. Tools and arguments (dates yyyyMMdd; sport codes 1 run, 2 ride, 5 trail run):\n' + COROS_INDEX + '\nIf COROS refuses a request, read coros_format for that tool.', object({ tool: z.enum(COROS_READS), arguments: corosArguments('coros_read', 'The COROS tool\'s arguments as an object; {} when it takes none.').optional(), ...paging })],
  coros_format: ['Read COROS\'s exact rules and arguments for one COROS tool, in pages. Read every page for a change tool before coros_write.', object({ tool: z.enum([...COROS_READS, ...COROS_WRITES]), ...paging })],
  coros_write: ['Save a COROS workout change: createScheduledWorkout (new workout on a date), scheduleWorkout (a library workout on a date), createSingleWorkout (new library workout), updateScheduledWorkout or updateWorkoutDetails. arguments must follow coros_format for that tool exactly. The user reviews it first and may edit, approve or decline it; the result says whether it was saved. COROS cannot remove a workout through Pocket, so check the date and sections.', object({
    tool: z.enum(COROS_WRITES), arguments: corosArguments('coros_write', 'Exactly the arguments coros_format describes for this tool.'), summary: z.string().min(1).max(300).meta({ description: 'One line for the review: what changes and why.' })
  })],
  search_web: ['Search current web information. Optionally limit to five domains, a time range, and the source or category: news for current events, research or pdf for papers and documents, github for code. Cite the urls you use.', object({
    query: z.string().min(1).max(300).meta({ description: 'What to search for.' }), limit: integer('Maximum results.', 1, 5, 5), domains: optional(z.array(z.string().max(253)).max(5)),
    time_range: optional(z.enum(['any', 'day', 'week', 'month', 'year']), undefined, 'any'), sources: optional(z.array(z.enum(['web', 'news', 'images'])).max(3)), categories: optional(z.array(z.enum(['research', 'pdf', 'github'])).max(3))
  })],
  read_web_page: ['Read a public page in 200–6000 character pages. Use next_offset to continue. Optional query finds relevant passages at or after offset; pages are cached for this reply.', object({ url: z.string().max(2048).meta({ description: 'The page\'s public https URL.' }), ...paging, query: search.query })]
};
export const SCHEMAS = Object.fromEntries(Object.entries(DEFINITIONS).map(([name, [, schema]]) => [name, schema]));

/** The AI SDK tools offered in this reply. run applies Pocket's per-reply limits and records the outcome. */
export function sdkTools(names, run) {
  return Object.fromEntries(names.filter(name => DEFINITIONS[name]).map(name => [name, tool({ description: DEFINITIONS[name][0], inputSchema: DEFINITIONS[name][1], execute: (input, options) => run(name, input, options) })]));
}
