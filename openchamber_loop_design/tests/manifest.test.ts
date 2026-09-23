import { test, expect } from "bun:test";

import { requestedGuestCapabilities } from "@openchamber/sdk";
import { parseManifest } from "@openchamber/sdk/schemas";

const manifest = await Bun.file("package.json").json();

test("declares the minimum OpenChamber v1 extension surface", () => {
  expect(manifest.name).toBe("openchamber_loop_design");
  expect(manifest.openchamber.apiVersion).toBe(1);
  expect(manifest.openchamber.engines.openchamber).toBe(">=1.24.2");
  expect(manifest.openchamber.contributes.panel.id).toBe("openchamber-loop-kanban");
  expect(manifest.openchamber.contributes.panel.entry).toBe("panel/index.html");
  expect(manifest.openchamber.contributes.page.entry).toBe("panel/page.html");
  expect(manifest.openchamber.contributes.capabilities).toEqual([
    "sessions",
    "prompt",
  ]);
});

test("does not request elevated capabilities", () => {
  const parsed = parseManifest(manifest);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Manifest must parse before grant inspection");
  const contributes = parsed.manifest.contributes;
  expect(contributes).not.toHaveProperty("service");
  expect(contributes).not.toHaveProperty("integration");
  expect(contributes).not.toHaveProperty("filesystem");
  expect(contributes).not.toHaveProperty("actions");
  expect([...requestedGuestCapabilities(contributes)].sort()).toEqual([
    "prompt",
    "sessions",
  ]);
});

test("is accepted by the official OpenChamber manifest parser", () => {
  expect(parseManifest(manifest).ok).toBe(true);
});

test("uses Bun's supported entry naming option for classic IIFE outputs", () => {
  expect(manifest.scripts.build).toContain("--entry-naming");
});
