// Run with: node --test tools/zines.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { bookletPages } from "../docs/js/zine-pdf.js";
import { monochrome } from "../docs/js/zine-render.js";

test("folded sheets keep covers outside and every reading page exactly once", () => {
  for (let count = 3; count <= 42; count++) {
    const sides = bookletPages(count);
    assert.equal(sides.length % 2, 0, "every sheet has a front and back");
    assert.deepEqual(sides[0], [count - 1, 0], "back and front cover on the outside");
    const content = sides.flat().filter(page => page !== null);
    assert.deepEqual(content.toSorted((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
    assert.equal(sides.flat().length % 4, 0);
    const folded = [];
    for (let sheet = 0; sheet < sides.length / 2; sheet++) {
      // Read the right-hand faces toward the centre, then return along the left.
      folded.push(sides[sheet * 2][1], sides[sheet * 2 + 1][0]);
    }
    for (let sheet = sides.length / 2 - 1; sheet >= 0; sheet--) {
      folded.push(sides[sheet * 2 + 1][1], sides[sheet * 2][0]);
    }
    assert.deepEqual(folded.filter(page => page !== null), Array.from({ length: count }, (_, i) => i));
  }
});
test("photographic treatments preserve a continuous tonal range and shadow detail", () => {
  for (const tone of ["deep", "soft"]) {
    const data = new Uint8ClampedArray(256 * 4);
    for (let x = 0; x < 256; x++) data.set([x, x, x, 255], x * 4);
    monochrome(data, 256, 1, tone);
    const shades = new Set();
    for (let x = 0; x < 256; x++) {
      const i = x * 4; shades.add(data[i]);
      assert.equal(data[i], data[i + 1]); assert.equal(data[i], data[i + 2]);
      assert.equal(data[i + 3], 255);
      if (x) assert.ok(data[i] >= data[i - 4], "tones stay in order");
    }
    assert.ok(shades.size > 230, "a photo keeps its midtones rather than turning into dots");
    assert.ok(data[32 * 4] > 20, "shadows retain visible detail");
    assert.ok(data[128 * 4] > 110 && data[128 * 4] < 140);
    assert.equal(data[0], 0); assert.equal(data[255 * 4], 255);
    const colour = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    monochrome(colour, 3, 1, tone);
    for (let i = 0; i < colour.length; i += 4) {
      assert.equal(colour[i], colour[i + 1]); assert.equal(colour[i], colour[i + 2]);
      assert.ok(colour[i] > 0 && colour[i] < 255);
    }
  }
});
test("optional graphic treatments preserve black/white and diffuse middle tones", () => {
  for (const tone of ["grain", "ink"]) {
    const width = 64, height = 8, data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, value = x === 0 ? 0 : x === width - 1 ? 255 : 140;
      data.set([value, value, value, 255], i);
    }
    monochrome(data, width, height, tone);
    const midtones = new Set();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      assert.equal(data[i], data[i + 1]); assert.equal(data[i], data[i + 2]); assert.equal(data[i + 3], 255);
      assert.ok(data[i] === 0 || data[i] === 255);
      if (x === 0) assert.equal(data[i], 0);
      else if (x === width - 1) assert.equal(data[i], 255);
      else midtones.add(data[i]);
    }
    assert.equal(midtones.size, tone === "ink" ? 1 : 2);
    const colour = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    monochrome(colour, 3, 1, tone);
    for (let i = 0; i < colour.length; i += 4) {
      assert.equal(colour[i], colour[i + 1]); assert.equal(colour[i], colour[i + 2]);
    }
  }
});
