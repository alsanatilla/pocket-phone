import type { Spec } from "@json-render/core";
import type { Moment } from "./context.ts";

/** Keep a working action card even if the model only produced decorative readings. */
export function withTodayActions(spec: Spec, moment: Moment): Spec {
  const type = moment.focus ? "FocusSession"
    : moment.agenda.next && moment.agenda.next.inMinutes >= 0 && moment.agenda.next.inMinutes <= 45 ? "EventPrep"
    : ["evening", "night"].includes(moment.now.phase) ? "DayReview" : "FocusSession";
  if (Object.values(spec.elements).some(element => element.type === type)) return spec;
  const elements = { ...spec.elements };
  let id = "today-action";
  while (elements[id]) id += "-1";
  elements[id] = { type, props: { title: null }, children: [] };
  const root = elements[spec.root];
  if (root?.type === "Stack") {
    const children = [...(root.children ?? [])];
    children.splice(elements[children[0] ?? ""]?.type === "Hero" ? 1 : 0, 0, id);
    elements[spec.root] = { ...root, children };
    return { ...spec, elements };
  }
  let wrapper = "today-root";
  while (elements[wrapper]) wrapper += "-1";
  elements[wrapper] = { type: "Stack", props: { direction: "vertical", gap: "lg" }, children: [spec.root, id] };
  return { ...spec, root: wrapper, elements };
}
