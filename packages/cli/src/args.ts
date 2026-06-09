export interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

/** Minimal `--flag value` / `--flag` parser. The first non-dash token is the command. */
export function parseArgs(argv: string[]): ParsedArgs {
  const first = argv[0];
  const command = first !== undefined && !first.startsWith("-") ? first : "";
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }

  return { command, flags };
}
