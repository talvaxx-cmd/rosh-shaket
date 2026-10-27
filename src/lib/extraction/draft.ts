import { z } from "zod";

/**
 * A draft is what the language layer *proposes*. Nothing is written until the
 * user confirms the card. Uncertain fields are listed explicitly so the UI can
 * highlight them instead of silently guessing.
 */

export const UncertaintySchema = z.object({
  field: z.enum(["date", "time", "duration", "title", "person", "location", "kind", "due", "recurrence", "reminder"]),
  /** Hebrew question shown to the user. */
  question: z.string(),
  /** When true the card cannot be saved until the user answers. */
  blocking: z.boolean(),
  /** Suggested answers. For time: "HH:mm"; for date: "YYYY-MM-DD"; otherwise free text. */
  options: z.array(z.string()),
});
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const RecurrenceDraftSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int(),
  byWeekday: z.array(z.number().int()),
});

export const DraftItemSchema = z.object({
  /** Local reference so items in one utterance can point at each other. */
  ref: z.string(),
  kind: z.enum(["event", "task", "unresolved"]),
  title: z.string(),
  /** The fragment of what the user said that produced this item. */
  sourceText: z.string(),
  /** Event date, or task deadline date. "YYYY-MM-DD" or null. */
  date: z.string().nullable(),
  /** Event start time, or task deadline time. "HH:mm" or null. */
  time: z.string().nullable(),
  durationMin: z.number().int().nullable(),
  /** True when the user said "בערך"/"משהו כמו" or the duration was not said at all. */
  durationIsEstimate: z.boolean(),
  /** Text exactly as said ("במשרד"). Never expanded into an address. */
  location: z.string().nullable(),
  /** People mentioned by name. Never linked to contacts automatically. */
  people: z.array(z.string()),
  importance: z.enum(["low", "normal", "high"]),
  /** Tasks: may the planner choose the time? */
  flexible: z.boolean(),
  /** Tasks: "השבוע", "בחודש הבא" … the earliest date to work on it, "YYYY-MM-DD". */
  notBefore: z.string().nullable(),
  preferredWindow: z.enum(["morning", "afternoon", "evening"]).nullable(),
  recurrence: RecurrenceDraftSchema.nullable(),
  /** Minutes before the start/deadline to remind. 0 = at the time. */
  reminderMinutesBefore: z.array(z.number().int()),
  /** For a task that prepares for an event in the same utterance: that event's ref. */
  prepForRef: z.string().nullable(),
  /** Unresolved items: what is missing. */
  question: z.string().nullable(),
  uncertainties: z.array(UncertaintySchema),
});
export type DraftItem = z.infer<typeof DraftItemSchema> & {
  /** Hebrew note about what was guessed (client-side only, not part of the model's output). */
  unsure?: string;
};

export const ExtractionSchema = z.object({
  items: z.array(DraftItemSchema),
  /** Short Hebrew note when nothing actionable was understood. */
  note: z.string().nullable(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractionContext {
  /** Instant of the request. */
  now: string;
  timeZone: string;
  dayStart: string;
  dayEnd: string;
  defaultEventMin: number;
  defaultTaskMin: number;
}

export interface ExtractResponse {
  mode: "ai" | "rules";
  items: DraftItem[];
  note: string | null;
  /** Shown when the AI path was attempted but fell back. */
  warning?: string;
}

export function emptyDraft(ref: string, kind: DraftItem["kind"], sourceText: string): DraftItem {
  return {
    ref,
    kind,
    title: "",
    sourceText,
    date: null,
    time: null,
    durationMin: null,
    durationIsEstimate: false,
    location: null,
    people: [],
    importance: "normal",
    flexible: kind === "task",
    notBefore: null,
    preferredWindow: null,
    recurrence: null,
    reminderMinutesBefore: [],
    prepForRef: null,
    question: null,
    uncertainties: [],
  };
}
