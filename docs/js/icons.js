// Port of PhoneIcon.java: glyphs are drawn on a 26×26 canvas and shown pixelated, like the phone's bitmap glyphs.
export const ICON = { DICE: 15, PARKING: 16, RECEIPT: 17, SYNC: 19 };

export function icon(kind, tint = "#fff", background = "#000", dot = false) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 26; canvas.className = "icon"; canvas.setAttribute("aria-hidden", "true");
  paint(canvas, kind, tint, background, dot); return canvas;
}
export function paint(canvas, kind, tint, cutout, dot = false) {
  const c = canvas.getContext("2d"); c.clearRect(0, 0, 26, 26); c.save(); c.translate(1, 1);
  c.lineWidth = 1.8; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = tint; c.fillStyle = tint;
  const rect = (l, t, r, b) => c.fillRect(l, t, r - l, b - t);
  const round = (l, t, r, b, radius) => { c.beginPath(); c.roundRect(l, t, r - l, b - t, radius); };
  const polygon = (...p) => { c.beginPath(); c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); c.fill(); };
  switch (kind) {
    case ICON.DICE:
      round(2, 2, 22, 22, 3); c.fill(); c.fillStyle = cutout;
      for (const [x, y] of [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]]) { c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill(); }
      break;
    case ICON.PARKING:
      round(2, 2, 22, 22, 2); c.fill(); c.fillStyle = cutout;
      rect(8, 6, 11, 19); rect(8, 6, 15, 9); rect(8, 12, 15, 15); rect(14, 7, 17, 14);
      break;
    case ICON.RECEIPT:
      polygon(4, 1, 20, 1, 20, 22, 18, 20, 16, 22, 14, 20, 12, 22, 10, 20, 8, 22, 6, 20, 4, 22); c.fillStyle = cutout;
      rect(7, 5, 17, 7); rect(7, 10, 14, 12); rect(7, 15, 17, 17);
      break;
    case ICON.SYNC: // A cloud with a two-way arrow; web only.
      c.beginPath(); c.arc(8, 13, 5, Math.PI * .5, Math.PI * 1.5); c.arc(13, 8, 6, Math.PI, 0); c.arc(18, 13, 5, Math.PI * 1.5, Math.PI * .5); c.closePath(); c.fill();
      c.fillStyle = cutout; rect(9, 12, 16, 14); polygon(9, 10, 6, 13, 9, 16); polygon(16, 10, 19, 13, 16, 16);
      break;
  }
  if (dot) { c.fillStyle = "#c08cdd"; c.beginPath(); c.arc(23, 1, 2, 0, Math.PI * 2); c.fill(); } // Same notification dot as Home.
  c.restore();
}
