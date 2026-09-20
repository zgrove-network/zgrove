/** One JSON object per line: greppable in a terminal, parseable by whatever
 * collects logs later, and never interleaved halfway through a record. */
export function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    event,
    ...fields,
  });

  if (level === "error") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}
