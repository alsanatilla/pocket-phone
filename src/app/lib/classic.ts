// The classic app lives at /classic while its areas move over. Everything that links there goes through here, so
// moving an area is one line in NEW_AREAS and no link has to change.

export const CLASSIC = "/classic";

/** Areas the new client draws itself. */
export const NEW_AREAS = new Set(["today", "notes", "pip", "settings", "jobs"]);

/** Areas only the classic app has so far. */
export const CLASSIC_AREAS = new Set([
  "tasks", "thoughts", "parking", "search", "receipt", "dice", "account", "sync", "link", "setup", "more", "apps",
  "calendar", "clock", "travel", "movement", "gym", "zines", "brief", "girder", "shadow",
]);

const area = (path: string) => path.replace(/^#?\/?/, "").split(/[/?]/)[0]!.toLowerCase();

/** The classic app's URL for an in-app path such as "/tasks/abc". */
export const classicHref = (path: string): string => CLASSIC + "#" + (path.startsWith("/") ? path : "/" + path);

/** Where an in-app path opens: here (as a hash) when the area has moved, in the classic app otherwise. */
export const hrefFor = (path: string): string => NEW_AREAS.has(area(path)) ? "#" + (path.startsWith("/") ? path : "/" + path) : classicHref(path);

export const isClassicArea = (path: string): boolean => CLASSIC_AREAS.has(area(path));

/** Opens an in-app path wherever it lives. */
export function openPath(path: string): void {
  const target = hrefFor(path);
  if (target.startsWith("#")) location.hash = target; else location.assign(target);
}
