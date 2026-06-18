import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type InstallTarget = "claude" | "codex" | "openclaw";

export const INSTALL_TARGETS: readonly InstallTarget[] = ["claude", "codex", "openclaw"];

const TARGET_SKILLS_DIR: Record<InstallTarget, string> = {
  claude: join(".claude", "skills"),
  codex: join(".codex", "skills"),
  openclaw: join(".openclaw", "skills"),
};

export function isInstallTarget(value: string): value is InstallTarget {
  return (INSTALL_TARGETS as readonly string[]).includes(value);
}

export interface InstallOptions {
  /** Home directory; defaults to the OS home. */
  home?: string;
  /** Path to the SKILL.md to install; defaults to this package's SKILL.md. */
  skillSource?: string;
}

/** Copy the TrackProof SKILL.md into each target coding agent's skills directory. */
export function installSkill(targets: InstallTarget[], options: InstallOptions = {}): string[] {
  const home = options.home ?? homedir();
  const source = options.skillSource ?? defaultSkillPath();
  const installed: string[] = [];
  for (const target of targets) {
    const dir = join(home, TARGET_SKILLS_DIR[target], "trackproof");
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, "SKILL.md");
    copyFileSync(source, dest);
    installed.push(dest);
  }
  return installed;
}

/** SKILL.md ships at the package root; from `dist/install.js` that is `../SKILL.md`. */
export function defaultSkillPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "SKILL.md");
}
