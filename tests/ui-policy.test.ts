import { expect, test } from "bun:test";

const sources = await Promise.all([
  Bun.file("panel/main.ts").text(),
  Bun.file("panel/page.ts").text(),
  Bun.file("src/render-panel.ts").text(),
  Bun.file("src/render-page.ts").text(),
]);
const source = sources.join("\n");

test("every surface applies every Host ready context", () => {
  expect(source.match(/applyHostReady\(/g)?.length).toBeGreaterThanOrEqual(2);
  expect(source).toContain("document.documentElement");
  expect(source).toContain("document.documentElement.lang = context.locale");
});

test("renderers use the OpenChamber UI kit without hard-coded visual tokens", () => {
  expect(source).toContain("@openchamber/sdk/ui");
  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|font-family\s*:/);
});

test("extension-owned labels use the Host locale with a defined fallback", () => {
  expect(source).toContain("formatMessage");
  expect(source).toContain('"zh-CN"');
  expect(source).toContain('"en"');
});
