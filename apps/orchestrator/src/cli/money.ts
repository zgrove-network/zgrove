export const ZAT_PER_ZEC = 100_000_000;
const ZEC_DECIMALS = 8;

/**
 * Parses a decimal ZEC amount into exact zatoshi by splitting the text,
 * rather than multiplying a float. `2.55 * 1e8` is 254999999.99999997 in
 * IEEE 754, so flooring it loses a zatoshi from an amount somebody is owed —
 * and 2.55 is an ordinary number, not a contrived one.
 */
export function parseZec(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Not a ZEC amount: ${text}`);
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > ZEC_DECIMALS) {
    // Silently dropping digits here would quietly change what is paid.
    throw new Error(`ZEC has ${ZEC_DECIMALS} decimals; ${text} has more`);
  }

  const padded = fraction.padEnd(ZEC_DECIMALS, "0");
  const zat = Number(whole) * ZAT_PER_ZEC + Number(padded);

  if (!Number.isSafeInteger(zat)) {
    throw new Error(`${text} is beyond the range this can represent exactly`);
  }
  return zat;
}

/** Zatoshi back to a full-precision ZEC string. Never rounds. */
export function formatZec(zat: number): string {
  const sign = zat < 0 ? "-" : "";
  const absolute = Math.abs(zat);
  const whole = Math.floor(absolute / ZAT_PER_ZEC);
  const fraction = String(absolute % ZAT_PER_ZEC).padStart(ZEC_DECIMALS, "0");
  return `${sign}${whole}.${fraction}`;
}

/** Accepts unix seconds or YYYY-MM-DD, which is midnight UTC. */
export function parseInstant(text: string): number {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match === null) {
    throw new Error(`Not a time: ${text} (use unix seconds or YYYY-MM-DD)`);
  }

  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms)) {
    throw new Error(`Not a date: ${text}`);
  }
  return Math.floor(ms / 1000);
}
