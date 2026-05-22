// Local-calendar date helpers. The service deploys to a China (UTC+8) host and
// users enter/read calendar dates in Asia/Shanghai, while timestamps are stored as
// UTC ISO strings. Comparing a UTC-derived "today" against locally-meaningful dates
// mislabels evening activity, so derive the *local* calendar date explicitly.
const TZ = "Asia/Shanghai";

// en-CA locale yields YYYY-MM-DD which matches our stored bare-date format.
const FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** The local (Asia/Shanghai) calendar date of an instant, as YYYY-MM-DD. */
export function localDateOf(instant: Date | string | number): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return FMT.format(d);
}

/** Today's local (Asia/Shanghai) calendar date, as YYYY-MM-DD. */
export function localToday(): string {
  return FMT.format(new Date());
}
