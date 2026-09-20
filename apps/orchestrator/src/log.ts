/** Read once: a log level that can change mid-process makes two records of
 * the same event disagree about whether they exist. */
const SILENT = process.env["ZGROVE_LOG"] === "silent";

/** One JSON object per line: greppable in a terminal, parseable by whatever
 * collects logs later, and never interleaved halfway through a record. */
export function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (SILENT) {
    return;
  }

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
