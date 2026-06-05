/**
 * Analytics Durable Object.
 *
 * A single global instance (addressed via `getByName('global')`) that
 * collects per-request events for the /admin dashboard. We use a single DO
 * — not per-IP or per-region — so the SQL aggregations don't need any
 * cross-shard merging. At Pictune's scale (≤100 transformations/hour/IP,
 * single-digit RPS in aggregate) a single DO sits comfortably under the
 * ~1k-writes-per-second-per-object ceiling.
 *
 * Storage shape: one row per request, append-only and never pruned. The
 * dashboard reports all-time usage, so every event is retained for the life
 * of the object. Rows are tiny (a timestamp, an IP, a 2-letter country code
 * and two short enums), so a single SQLite DO stays comfortably within its
 * storage budget at this app's scale for years.
 *
 * Why a DO instead of Workers Analytics Engine? Analytics Engine is the
 * "proper" tool here, but querying it requires a separate API token and an
 * out-of-Worker SQL hop. For an internal admin page that gets opened a
 * handful of times a day, a SQLite DO is simpler and cheaper.
 */
import { DurableObject } from 'cloudflare:workers';

export type Tool = 'background' | 'upscale' | 'expand';

/**
 * The outcome we record for each request.
 *
 *   accepted     — passed every gate AND the route handler returned 2xx
 *                  (Replicate accepted the prediction). The request "spent"
 *                  one Replicate credit.
 *   bot_blocked  — Cloudflare Turnstile rejected the request (missing token,
 *                  expired/replayed token, or siteverify said `success: false`).
 *                  Counted before the rate limiter, so a flood of bot traffic
 *                  doesn't consume a real user's quota.
 *   rate_limited — Turnstile passed but the IP had already used its hourly
 *                  Replicate quota.
 *   failed       — both gates passed but the handler threw (e.g. Replicate
 *                  5xx, malformed multipart, image upload too big).
 */
export type Outcome = 'accepted' | 'bot_blocked' | 'rate_limited' | 'failed';

export interface AnalyticsEvent {
	ts: number;
	ip: string;
	country: string | null;
	tool: Tool;
	outcome: Outcome;
}

/** Single top-N IP row in the admin payload. */
export interface TopIp {
	ip: string;
	count: number;
	last_seen: number;
}

/** One bucket in the all-time daily activity chart. */
export interface DailyBucket {
	/** Bucket start, ms since epoch, aligned to the UTC day. */
	day: number;
	count: number;
}

/**
 * One row in the "By country" breakdown. The `country` field is normally a
 * 2-letter ISO 3166-1 alpha-2 code (e.g. "GB"), but two sentinel values are
 * possible:
 *
 *   "Unknown" — request had no Cloudflare-derived country (most common in
 *               `wrangler dev` where `request.cf` is synthetic).
 *   "Other"   — the small countries that didn't make the top-N have been
 *               collapsed into a single bucket so the bar chart stays legible.
 */
export interface CountryStat {
	country: string;
	count: number;
}

/** Trimmed event shape returned to the admin client (no schema-internal columns). */
export interface RecentEvent {
	ts: number;
	ip: string;
	country: string | null;
	tool: Tool;
	outcome: Outcome;
}

export interface AdminStats {
	/** Server time when the snapshot was assembled. */
	generated_at: number;
	/** Aggregate request counts across rolling windows. */
	totals: {
		all_time: number;
		last_hour: number;
		last_24h: number;
		last_7d: number;
	};
	/** Per-tool counts, all-time. */
	by_tool: Record<Tool, number>;
	/** Per-outcome counts, all-time. */
	by_outcome: Record<Outcome, number>;
	/**
	 * Top countries by request count, all-time. Up to TOP_COUNTRIES entries
	 * plus an "Other" bucket aggregating the rest. Sorted by count
	 * descending, ties broken alphabetically for stable ordering across
	 * refreshes.
	 */
	by_country: CountryStat[];
	/** Distinct IPs seen all-time. */
	unique_ips: number;
	/** Top 10 IPs by request count, all-time. */
	top_ips: TopIp[];
	/** One bucket per day from the first event through today, oldest first. */
	daily: DailyBucket[];
	/** Most recent 50 events, newest first. */
	recent: RecentEvent[];
}

/* SQLite exec<T>() requires T to extend Record<string, SqlStorageValue>.
 * Using `type` aliases (rather than `interface`) so they pick up the
 * implicit string index signature SqlStorageValue compatibility needs. */
type CountRow = { count: number };
type ToolCountRow = { tool: string; count: number };
type OutcomeCountRow = { outcome: string; count: number };
type CountryCountRow = { country: string | null; count: number };
type TopIpRow = { ip: string; count: number; last_seen: number };
type DayBucketRow = { day: number; count: number };
type MinTsRow = { min_ts: number | null };
type EventRow = {
	ts: number;
	ip: string;
	country: string | null;
	tool: string;
	outcome: string;
};

/** How many top countries we surface before collapsing the long tail. */
const TOP_COUNTRIES = 5;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export class Analytics extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// One-time schema init. blockConcurrencyWhile ensures no log()/stats()
		// call can race the CREATE TABLE.
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS events (
					ts INTEGER NOT NULL,
					ip TEXT NOT NULL,
					country TEXT,
					tool TEXT NOT NULL,
					outcome TEXT NOT NULL
				);
				CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
				CREATE INDEX IF NOT EXISTS idx_events_ip ON events(ip);
			`);
		});
	}

	/**
	 * Append one event. Events are kept indefinitely so the dashboard can
	 * report all-time usage — there is no pruning step.
	 */
	async log(event: AnalyticsEvent): Promise<void> {
		this.ctx.storage.sql.exec(
			'INSERT INTO events (ts, ip, country, tool, outcome) VALUES (?, ?, ?, ?, ?)',
			event.ts,
			event.ip,
			event.country,
			event.tool,
			event.outcome,
		);
	}

	/** Assemble everything the admin dashboard needs in one shot. */
	async stats(): Promise<AdminStats> {
		const now = Date.now();
		const hourCutoff = now - HOUR_MS;
		const dayCutoff = now - DAY_MS;
		const weekCutoff = now - 7 * DAY_MS;
		const sql = this.ctx.storage.sql;

		const totals = {
			all_time: sql.exec<CountRow>('SELECT COUNT(*) AS count FROM events').one().count,
			last_hour: sql
				.exec<CountRow>('SELECT COUNT(*) AS count FROM events WHERE ts >= ?', hourCutoff)
				.one().count,
			last_24h: sql
				.exec<CountRow>('SELECT COUNT(*) AS count FROM events WHERE ts >= ?', dayCutoff)
				.one().count,
			last_7d: sql
				.exec<CountRow>('SELECT COUNT(*) AS count FROM events WHERE ts >= ?', weekCutoff)
				.one().count,
		};

		// Per-tool counts (all-time). Initialise with zeros so the response
		// always has all three keys even when one tool has never been used.
		const by_tool: Record<Tool, number> = { background: 0, upscale: 0, expand: 0 };
		for (const row of sql.exec<ToolCountRow>(
			'SELECT tool, COUNT(*) AS count FROM events GROUP BY tool',
		)) {
			if (isTool(row.tool)) by_tool[row.tool] = row.count;
		}

		const by_outcome: Record<Outcome, number> = {
			accepted: 0,
			bot_blocked: 0,
			rate_limited: 0,
			failed: 0,
		};
		for (const row of sql.exec<OutcomeCountRow>(
			'SELECT outcome, COUNT(*) AS count FROM events GROUP BY outcome',
		)) {
			if (isOutcome(row.outcome)) by_outcome[row.outcome] = row.count;
		}

		// Country breakdown. We pull every grouped row sorted by count, then
		// keep the top N in the response and roll everything else into a single
		// "Other" entry. Tie-breaking by country code keeps the order stable
		// across refreshes when two countries have the same hit count.
		const allCountries: CountryStat[] = [];
		for (const row of sql.exec<CountryCountRow>(
			`SELECT country, COUNT(*) AS count
			 FROM events
			 GROUP BY country ORDER BY count DESC, country ASC`,
		)) {
			allCountries.push({ country: row.country ?? 'Unknown', count: row.count });
		}
		const by_country: CountryStat[] =
			allCountries.length <= TOP_COUNTRIES + 1
				? allCountries
				: [
						...allCountries.slice(0, TOP_COUNTRIES),
						{
							country: 'Other',
							count: allCountries
								.slice(TOP_COUNTRIES)
								.reduce((acc, row) => acc + row.count, 0),
						},
					];

		const unique_ips = sql
			.exec<CountRow>('SELECT COUNT(DISTINCT ip) AS count FROM events')
			.one().count;

		const top_ips: TopIp[] = [];
		for (const row of sql.exec<TopIpRow>(
			`SELECT ip, COUNT(*) AS count, MAX(ts) AS last_seen
			 FROM events
			 GROUP BY ip ORDER BY count DESC LIMIT 10`,
		)) {
			top_ips.push({ ip: row.ip, count: row.count, last_seen: row.last_seen });
		}

		// Daily histogram, all-time: one bucket per UTC day from the first
		// recorded event through today, with empty days materialised so the
		// chart's x-axis has no gaps. The rightmost bucket is the current
		// (partial) day so the last bar always represents "today".
		//
		// DAY_MS is interpolated into the SQL (rather than bound via ?) so
		// SQLite parses it as an INTEGER literal. Bound JS numbers come
		// through as REAL, which silently turns `ts / 86400000` into REAL
		// division — every event then lands in its own float-keyed bucket
		// because the multiply-back doesn't round to an exact day. The value
		// is a compile-time constant, so string interpolation is safe.
		const firstTs = sql
			.exec<MinTsRow>('SELECT MIN(ts) AS min_ts FROM events')
			.one().min_ts;
		const daily: DailyBucket[] = [];
		if (firstTs != null) {
			const dayMap = new Map<number, number>();
			for (const row of sql.exec<DayBucketRow>(
				`SELECT (ts / ${DAY_MS}) * ${DAY_MS} AS day, COUNT(*) AS count
				 FROM events GROUP BY day ORDER BY day ASC`,
			)) {
				dayMap.set(row.day, row.count);
			}
			const firstDay = Math.floor(firstTs / DAY_MS) * DAY_MS;
			const today = Math.floor(now / DAY_MS) * DAY_MS;
			for (let day = firstDay; day <= today; day += DAY_MS) {
				daily.push({ day, count: dayMap.get(day) ?? 0 });
			}
		}

		const recent: RecentEvent[] = [];
		for (const row of sql.exec<EventRow>(
			'SELECT ts, ip, country, tool, outcome FROM events ORDER BY ts DESC LIMIT 50',
		)) {
			if (!isTool(row.tool) || !isOutcome(row.outcome)) continue;
			recent.push({
				ts: row.ts,
				ip: row.ip,
				country: row.country,
				tool: row.tool,
				outcome: row.outcome,
			});
		}

		return {
			generated_at: now,
			totals,
			by_tool,
			by_outcome,
			by_country,
			unique_ips,
			top_ips,
			daily,
			recent,
		};
	}
}

function isTool(value: string): value is Tool {
	return value === 'background' || value === 'upscale' || value === 'expand';
}

function isOutcome(value: string): value is Outcome {
	return (
		value === 'accepted' ||
		value === 'bot_blocked' ||
		value === 'rate_limited' ||
		value === 'failed'
	);
}
