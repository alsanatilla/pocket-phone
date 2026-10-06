// Only provider events and completed local reads create activity. Assistant text never does.
export const clip = (value, limit = 240) => String(value ?? "").slice(0, limit);
export function source(value) {
  if (!value || typeof value !== "object") return null;
  let href = String(value.href || value.url || "");
  if (!/^\/(?:notes|tasks|thoughts|gym|movement)(?:\/|$)/.test(href)) {
    try { const url = new URL(href); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null; href = url.href; } catch { return null; }
  }
  if (href.length > 2048) return null;
  return { href, title: clip(value.title || href, 160) };
}
export function activity(items = []) {
  if (!Array.isArray(items)) return [];
  let size = 0;
  return items.slice(0, 32).flatMap(item => {
    if (!item?.id || !["queued", "running", "done", "failed", "stopped"].includes(item.state)) return [];
    const row = { id: clip(item.id, 200), kind: item.kind === "web" ? "web" : "tool", name: clip(item.name, 80),
      title: clip(item.title), input: clip(item.input, 1024), state: item.state, summary: clip(item.summary, 500),
      started: Number(item.started) || 0, ended: Number(item.ended) || 0,
      sources: (Array.isArray(item.sources) ? item.sources : []).slice(0, 8).map(source).filter(Boolean) };
    size += JSON.stringify(row).length; return size <= 64000 ? [row] : [];
  });
}
export function settle(items, state, summary = "") {
  return activity(items).map(row => ["queued", "running"].includes(row.state) ? { ...row, state, summary: clip(summary || (state === "stopped" ? "Stopped" : "No result returned")), ended: Date.now() } : row);
}
export const elapsed = row => row.ended > row.started ? Math.max(1, Math.round((row.ended - row.started) / 1000)) + "s" : "";
export const mark = state => ({ queued: "◇", running: "◌", done: "□", failed: "△", stopped: "−" })[state] || "◇";
export function activityTitle(rows) {
  const live = rows.find(row => row.state === "running") || rows.find(row => row.state === "queued");
  if (live) return mark(live.state) + " " + live.title;
  const names = [...new Set(rows.map(row => row.kind === "web" ? "Web" : row.name.includes("note") ? "Notes" : row.name.includes("thought") ? "Thoughts" : row.name.includes("task") ? "Tasks" : row.name.includes("gym") ? "Gym" : row.name.includes("coros") ? "COROS" : row.title))];
  const failed = rows.some(row => row.state === "failed"), stopped = rows.some(row => row.state === "stopped");
  return (failed ? "△ " : stopped ? "− " : "□ ") + names.join(" + ") + " · " + rows.length + (rows.length === 1 ? " step" : " steps") + (failed ? " · failed" : stopped ? " · stopped" : "");
}
export const phaseLabel = value => value === "requesting" ? "◌ linking up" : value === "thinking" ? "◇ turning it over" : value === "writing" ? "□ writing" : value === "preparing reply" ? "◇ lining it up" : "◌ " + (value || "linking up");
