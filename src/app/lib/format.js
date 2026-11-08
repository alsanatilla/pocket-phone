export const clock = value => new Date(Number(value) || Date.now())
  .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export const dayTitle = (at = Date.now()) => new Date(at)
  .toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });

export const message = error => String(error?.message || error || "Something went wrong.").slice(0, 200);
