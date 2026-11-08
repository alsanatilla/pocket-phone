import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Radix measures and observes elements; jsdom has neither, and the components only need them to exist.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); });
