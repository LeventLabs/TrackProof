/**
 * Canonical JSON serialization — the single source of truth for hashing and signing.
 *
 * The rules are frozen; any reimplementation (in any language) must reproduce the
 * exact bytes asserted by the golden vector in `canonical.test.ts`:
 *
 *  - object keys are sorted with the default lexicographic (UTF-16 code unit) order;
 *  - object entries whose value is `undefined` are omitted entirely;
 *  - arrays preserve order; an `undefined`/`null` element serializes as `null`;
 *  - strings use standard JSON escaping;
 *  - numbers must be finite and serialize via the shortest round-trip form
 *    (ECMAScript Number-to-String). Market values (prices, sizes, amounts) are
 *    string-encoded in the schema to avoid floating-point ambiguity;
 *  - booleans and null serialize as `true` / `false` / `null`.
 */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined };

export function canonicalize(value: CanonicalValue): string {
  return write(value);
}

function write(value: CanonicalValue): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`non-finite number is not canonicalizable: ${value}`);
      }
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) {
        return "[" + value.map((element) => write(element ?? null)).join(",") + "]";
      }
      return writeObject(value);
    default:
      throw new TypeError(`unsupported value type: ${typeof value}`);
  }
}

function writeObject(obj: { [key: string]: CanonicalValue | undefined }): string {
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  const entries = keys.map((key) => JSON.stringify(key) + ":" + write(obj[key] as CanonicalValue));
  return "{" + entries.join(",") + "}";
}
