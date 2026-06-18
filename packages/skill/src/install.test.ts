import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSkillPath, installSkill, isInstallTarget } from "./install.js";

test("installSkill copies SKILL.md into each requested target only", () => {
  const home = mkdtempSync(join(tmpdir(), "tp-home-"));
  try {
    const installed = installSkill(["claude", "codex"], { home });
    assert.equal(installed.length, 2);
    assert.ok(existsSync(join(home, ".claude", "skills", "trackproof", "SKILL.md")));
    assert.ok(existsSync(join(home, ".codex", "skills", "trackproof", "SKILL.md")));
    assert.equal(existsSync(join(home, ".openclaw", "skills", "trackproof", "SKILL.md")), false);
    assert.match(readFileSync(installed[0]!, "utf8"), /name:\s*trackproof/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installSkill honors a custom skill source", () => {
  const home = mkdtempSync(join(tmpdir(), "tp-home-"));
  const source = join(home, "custom-SKILL.md");
  writeFileSync(source, "---\nname: trackproof\n---\ncustom");
  try {
    const [dest] = installSkill(["claude"], { home, skillSource: source });
    assert.equal(readFileSync(dest!, "utf8"), "---\nname: trackproof\n---\ncustom");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("isInstallTarget validates targets", () => {
  assert.ok(isInstallTarget("claude"));
  assert.ok(isInstallTarget("openclaw"));
  assert.equal(isInstallTarget("vscode"), false);
});

test("defaultSkillPath resolves to a SKILL.md", () => {
  assert.match(defaultSkillPath(), /SKILL\.md$/);
});
