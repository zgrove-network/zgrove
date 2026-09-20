const SI = ["", "k", "M", "G", "T", "P", "E"] as const;

/** 17240000000 -> "17.2 G". Keeps three significant figures, which is more
 * precision than an estimate off share weight actually carries. */
export function siPrefix(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0 ";
  }

  let scaled = value;
  let step = 0;
  while (Math.abs(scaled) >= 1000 && step < SI.length - 1) {
    scaled /= 1000;
    step += 1;
  }

  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${SI[step] ?? ""}`;
}

export function percent(part: number, whole: number): string {
  if (whole === 0) {
    return "-";
  }
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function agoFrom(unixSeconds: number | null, nowSeconds: number): string {
  if (unixSeconds === null) {
    return "never";
  }

  const seconds = Math.max(0, nowSeconds - unixSeconds);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** "90m", "2h", "1d", or a bare number of seconds. */
export function parseDuration(text: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(text.trim());
  if (match === null) {
    throw new Error(`Not a duration: ${text} (try 30m, 6h, 1d)`);
  }

  const amount = Number(match[1] ?? "0");
  switch (match[2]) {
    case "m":
      return amount * 60;
    case "h":
      return amount * 3600;
    case "d":
      return amount * 86400;
    default:
      return amount;
  }
}

export function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}
