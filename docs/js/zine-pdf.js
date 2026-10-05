import { PAGE_WIDTH, PAGE_HEIGHT, pageCount, renderer } from "./zine-render.js?v=20261005-tasks1";

// Four-page signatures, with padding inside the covers. The final PDF side is
// A5 landscape; each half folds down to an A6 pocket book.
export function bookletPages(count) {
  const padded = Math.ceil(count / 4) * 4, sides = [];
  const page = slot => slot === padded - 1 ? count - 1 : slot < count - 1 ? slot : null;
  for (let sheet = 0; sheet < padded / 4; sheet++) {
    sides.push([page(padded - 1 - sheet * 2), page(sheet * 2)]);
    sides.push([page(sheet * 2 + 1), page(padded - 2 - sheet * 2)]);
  }
  return sides;
}
export async function makePDF(book, booklet = false, progress = () => {}) {
  const count = pageCount(book), sides = booklet ? bookletPages(count) : Array.from({ length: count }, (_, i) => [i]);
  const encode = value => new TextEncoder().encode(value);
  const chunks = [encode("%PDF-1.4\n%pocket-zine\n")], offsets = [0];
  let length = chunks[0].length, nextId = 3;
  const append = bytes => { chunks.push(bytes); length += bytes.length; };
  const object = (id, value, stream) => {
    offsets[id] = length;
    append(encode(`${id} 0 obj\n${value}\n`));
    if (stream) { append(encode("stream\n")); append(stream); append(encode("\nendstream\n")); }
    append(encode("endobj\n"));
  };
  const painter = renderer(), pages = [];
  try {
    for (let side = 0; side < sides.length; side++) {
      const pageId = nextId++, contentId = nextId++, resources = [];
      let commands = "";
      for (let half = 0; half < sides[side].length; half++) {
        const surface = await painter.page(book, sides[side][half], 4);
        const pixels = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data;
        const gray = new Uint8Array(surface.width * surface.height);
        for (let i = 0; i < gray.length; i++) gray[i] = pixels[i * 4];
        const compressed = typeof CompressionStream === "function";
        const bytes = compressed ? new Uint8Array(await new Response(new Blob([gray]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()) : gray;
        const imageId = nextId++;
        object(imageId, `<< /Type /XObject /Subtype /Image /Width ${surface.width} /Height ${surface.height} /ColorSpace /DeviceGray /BitsPerComponent 8${compressed ? " /Filter /FlateDecode" : ""} /Length ${bytes.length} >>`, bytes);
        resources.push(`/Im${imageId} ${imageId} 0 R`);
        commands += `q\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} ${half * PAGE_WIDTH} 0 cm\n/Im${imageId} Do\nQ\n`;
        surface.width = surface.height = 1;
      }
      const stream = encode(commands);
      object(contentId, `<< /Length ${stream.length} >>`, stream);
      object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH * sides[side].length} ${PAGE_HEIGHT}] /Resources << /XObject << ${resources.join(" ")} >> >> /Contents ${contentId} 0 R >>`);
      pages.push(`${pageId} 0 R`);
      progress(side + 1, sides.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.join(" ")}] >>`);
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    const xref = length;
    let table = `xref\n0 ${nextId}\n0000000000 65535 f \n`;
    for (let id = 1; id < nextId; id++) table += String(offsets[id]).padStart(10, "0") + " 00000 n \n";
    append(encode(table + `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return new Blob(chunks, { type: "application/pdf" });
  } finally { painter.clear(); }
}
