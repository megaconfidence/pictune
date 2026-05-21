/**
 * Per-IP rate limiter Durable Object.
 *
 * One DO instance per client IP, addressed via
 * `env.RATE_LIMITER.getByName(ip)`. Each instance keeps a small SQLite
 * table of request timestamps for the current sliding hour window, so
 * the limit is genuinely "N transformations in any 60-minute span" —
 * not a fixed clock-hour window that resets at the top of the hour
 * (which would let a single IP do 200 requests in 2 minutes by straddling
 * the boundary).
 *
 * Why Durable Objects instead of the built-in Workers Rate Limiting
 * binding? The binding's `simple.period` only supports 10 or 60 seconds.
 * For hourly enforcement we need our own counter with a longer memory.
 *
 * Storage cost is bounded: at most LIMIT timestamps per IP per hour;
 * 100 INTEGER rows = a few KB per active IP. Old rows are pruned on
 * every check, so an idle IP's DO storage trends toward empty.
 */
import { DurableObject } from 'cloudflare:workers';

/** Sliding window length. */
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Max successful transformations per IP within any rolling WINDOW_MS span. */
const LIMIT = 100;

export interface RateLimitResult {
	/** True if the current request is within the quota and has been recorded. */
	allowed: boolean;
	/** How many more requests this IP can make before hitting the limit. */
	remaining: number;
	/** The hard ceiling — `LIMIT`. Echoed back so the client doesn't have to know it. */
	limit: number;
	/**
	 * Seconds until the next quota slot opens. 0 when allowed. When denied,
	 * this is `(oldest_timestamp + WINDOW_MS - now) / 1000` rounded up — i.e.
	 * the time at which the oldest counted request falls out of the window.
	 */
	retryAfter: number;
}

// The SQLite exec<T>() generic requires T to extend Record<string,
// SqlStorageValue> — `type` aliases pick up an implicit string index
// signature where `interface` declarations do not, hence using type here.
type CountRow = { count: number };
type OldestRow = { oldest: number };

export class RateLimiter extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// Run schema setup once per instance startup. blockConcurrencyWhile
		// ensures no consume() call can race the CREATE TABLE.
		ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS requests (
					timestamp INTEGER NOT NULL
				);
				CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
			`);
		});
	}

	/**
	 * Try to consume one quota unit. Atomic — the single-threaded execution
	 * model of Durable Objects means two concurrent requests for the same
	 * IP can't both squeak past the limit check.
	 */
	async consume(): Promise<RateLimitResult> {
		const now = Date.now();
		const cutoff = now - WINDOW_MS;

		// Prune anything that's fallen out of the sliding window. Cheap thanks
		// to the timestamp index.
		this.ctx.storage.sql.exec('DELETE FROM requests WHERE timestamp <= ?', cutoff);

		const { count } = this.ctx.storage.sql
			.exec<CountRow>('SELECT COUNT(*) AS count FROM requests')
			.one();

		if (count >= LIMIT) {
			// At quota. Surface retryAfter so the client (and any future
			// Retry-After header) can be honest about when to come back.
			const { oldest } = this.ctx.storage.sql
				.exec<OldestRow>('SELECT MIN(timestamp) AS oldest FROM requests')
				.one();
			const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
			return { allowed: false, remaining: 0, limit: LIMIT, retryAfter };
		}

		// Under quota — record this request and let it through.
		this.ctx.storage.sql.exec('INSERT INTO requests (timestamp) VALUES (?)', now);
		return {
			allowed: true,
			remaining: LIMIT - count - 1,
			limit: LIMIT,
			retryAfter: 0,
		};
	}
}
