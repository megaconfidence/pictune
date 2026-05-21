import clsx from 'clsx';
import { Lock, LogOut, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type {
	AdminStats,
	CountryStat,
	HourlyBucket,
	Outcome,
	RecentEvent,
	Tool,
	TopIp,
} from './analytics';

/**
 * Admin dashboard mounted at `/admin`. Two states:
 *
 *   1. Unauthenticated → centered passphrase card. Submitting calls
 *      /api/admin/stats with the entered passphrase; a 200 transitions us
 *      to the dashboard, a 401 shows an inline error.
 *
 *   2. Authenticated → usage dashboard. Auto-refreshes every 30s and
 *      exposes a manual refresh button. The passphrase lives in
 *      sessionStorage so a page refresh keeps the admin signed in (but
 *      closing the tab forgets it — admin passphrases shouldn't survive
 *      a browser quit).
 *
 * If the server ever returns 401 mid-session (e.g. the operator rotated
 * the secret), we drop the cached passphrase and surface a "session
 * expired" message on the login card.
 */

const STORAGE_KEY = 'pictune.admin.passphrase';
const REFRESH_INTERVAL_MS = 30_000;

class UnauthorizedError extends Error {
	constructor() {
		super('Unauthorized');
		this.name = 'UnauthorizedError';
	}
}

async function fetchStats(passphrase: string): Promise<AdminStats> {
	const res = await fetch('/api/admin/stats', {
		headers: { 'X-Admin-Passphrase': passphrase },
	});
	if (res.status === 401) throw new UnauthorizedError();
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Stats fetch failed (${res.status}): ${body.slice(0, 200)}`);
	}
	return (await res.json()) as AdminStats;
}

export default function AdminApp() {
	const [passphrase, setPassphrase] = useState<string | null>(() =>
		sessionStorage.getItem(STORAGE_KEY),
	);
	const [stats, setStats] = useState<AdminStats | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expiredNotice, setExpiredNotice] = useState<string | null>(null);

	const signOut = useCallback(() => {
		sessionStorage.removeItem(STORAGE_KEY);
		setPassphrase(null);
		setStats(null);
		setError(null);
	}, []);

	const refresh = useCallback(
		async (current: string) => {
			setLoading(true);
			setError(null);
			try {
				const next = await fetchStats(current);
				setStats(next);
			} catch (err) {
				if (err instanceof UnauthorizedError) {
					signOut();
					setExpiredNotice('Your session expired. Please sign in again.');
				} else {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				setLoading(false);
			}
		},
		[signOut],
	);

	// Initial load + auto-refresh. Keyed on the passphrase so a fresh sign-in
	// kicks off a new poll cycle and signing out tears the old one down.
	useEffect(() => {
		if (!passphrase) return;
		void refresh(passphrase);
		const id = window.setInterval(() => {
			void refresh(passphrase);
		}, REFRESH_INTERVAL_MS);
		return () => window.clearInterval(id);
	}, [passphrase, refresh]);

	const handleSignIn = useCallback(async (entered: string) => {
		setError(null);
		setExpiredNotice(null);
		setLoading(true);
		try {
			const next = await fetchStats(entered);
			sessionStorage.setItem(STORAGE_KEY, entered);
			setPassphrase(entered);
			setStats(next);
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				setError('Incorrect passphrase');
			} else {
				setError(err instanceof Error ? err.message : String(err));
			}
		} finally {
			setLoading(false);
		}
	}, []);

	const handleManualRefresh = useCallback(() => {
		if (passphrase) void refresh(passphrase);
	}, [passphrase, refresh]);

	if (!passphrase) {
		return (
			<LoginCard
				onSubmit={handleSignIn}
				loading={loading}
				error={error}
				notice={expiredNotice}
			/>
		);
	}

	return (
		<Dashboard
			stats={stats}
			loading={loading}
			error={error}
			onRefresh={handleManualRefresh}
			onSignOut={signOut}
		/>
	);
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Login                                                                     *
 * ──────────────────────────────────────────────────────────────────────── */

function LoginCard({
	onSubmit,
	loading,
	error,
	notice,
}: {
	onSubmit: (passphrase: string) => void;
	loading: boolean;
	error: string | null;
	notice: string | null;
}) {
	const [value, setValue] = useState('');

	return (
		<div className="grid min-h-screen place-items-center bg-[var(--color-canvas)] p-6">
			<form
				onSubmit={(e) => {
					e.preventDefault();
					const trimmed = value.trim();
					if (trimmed) onSubmit(trimmed);
				}}
				className="card-floating w-full max-w-sm p-6"
			>
				<div className="flex items-center gap-3">
					<div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-surface-hover)]">
						<Lock
							className="h-5 w-5 text-[var(--color-ink)]"
							strokeWidth={2}
						/>
					</div>
					<div>
						<h1 className="text-[15px] font-semibold leading-tight text-[var(--color-ink)]">
							Pictune Analytics
						</h1>
						<p className="mt-0.5 text-[12.5px] leading-tight text-[var(--color-ink-muted)]">
							Admin access required
						</p>
					</div>
				</div>

				{notice && (
					<div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug font-medium text-amber-800">
						{notice}
					</div>
				)}

				<label className="mt-5 block">
					<span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-muted)]">
						Passphrase
					</span>
					<input
						type="password"
						autoFocus
						autoComplete="current-password"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						disabled={loading}
						placeholder="Enter passphrase"
						className={clsx(
							'mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-[14px] text-[var(--color-ink)]',
							'border-[var(--color-line)] placeholder:text-[var(--color-ink-subtle)]',
							'transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
							'focus:border-[var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/15',
							'disabled:cursor-not-allowed disabled:bg-[var(--color-surface-hover)]',
						)}
					/>
				</label>

				{error && (
					<div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12.5px] font-medium text-red-700">
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={loading || !value.trim()}
					className={clsx(
						'mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-semibold text-white',
						'bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]',
						'transition-[background-color,scale] duration-150 active:scale-[0.98]',
						'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[var(--color-brand)]',
					)}
				>
					{loading && <InlineSpinner />}
					<span>Sign in</span>
				</button>
			</form>
		</div>
	);
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Dashboard                                                                 *
 * ──────────────────────────────────────────────────────────────────────── */

function Dashboard({
	stats,
	loading,
	error,
	onRefresh,
	onSignOut,
}: {
	stats: AdminStats | null;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	onSignOut: () => void;
}) {
	return (
		<div className="min-h-screen bg-[var(--color-canvas)]">
			<header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-white/95 backdrop-blur">
				<div className="mx-auto flex max-w-[1080px] items-center justify-between px-6 py-4">
					<div className="min-w-0">
						<h1 className="text-[15px] font-semibold leading-tight text-[var(--color-ink)]">
							Pictune Analytics
						</h1>
						<p className="mt-0.5 text-[12.5px] leading-tight text-[var(--color-ink-muted)] tabular-nums">
							{stats ? (
								<>
									Updated <LiveAgo ts={stats.generated_at} />
								</>
							) : loading ? (
								'Loading…'
							) : (
								'No data yet'
							)}
							{stats && loading && (
								<span className="ml-2 text-[var(--color-ink-subtle)]">
									Refreshing…
								</span>
							)}
						</p>
					</div>
					<div className="flex items-center gap-1">
						<button
							onClick={onRefresh}
							disabled={loading}
							aria-label="Refresh"
							title="Refresh"
							className={clsx(
								'inline-grid h-10 w-10 place-items-center rounded-xl text-[var(--color-ink-muted)]',
								'transition-[background-color,color] duration-150 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]',
								'disabled:cursor-not-allowed disabled:opacity-50',
							)}
						>
							<RefreshCw
								className={clsx('h-4.5 w-4.5', loading && 'animate-spin')}
								strokeWidth={2}
							/>
						</button>
						<button
							onClick={onSignOut}
							className={clsx(
								'inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium',
								'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]',
								'transition-colors duration-150',
							)}
						>
							<LogOut className="h-4 w-4" strokeWidth={2} />
							Sign out
						</button>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-[1080px] space-y-4 p-6">
				{error && (
					<div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
						{error}
					</div>
				)}

				{!stats ? (
					<div className="card-floating grid place-items-center py-24 text-[13px] text-[var(--color-ink-muted)]">
						<InlineSpinner />
					</div>
				) : (
					<StatsView stats={stats} />
				)}
			</main>
		</div>
	);
}

function StatsView({ stats }: { stats: AdminStats }) {
	const acceptedPct =
		stats.totals.last_24h > 0
			? Math.round((stats.by_outcome.accepted / stats.totals.last_24h) * 100)
			: 0;
	return (
		<>
			{/* Top stat cards */}
			<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
				<StatCard label="Last hour" value={stats.totals.last_hour} />
				<StatCard label="Last 24 hours" value={stats.totals.last_24h} />
				<StatCard label="Last 7 days" value={stats.totals.last_7d} />
				<StatCard label="All time" value={stats.totals.all_time} />
			</div>

			{/* Activity chart */}
			<div className="card-floating p-5">
				<CardHeader title="Activity" subtitle="Hourly, last 24 hours" />
				<HourlyChart buckets={stats.hourly} />
			</div>

			{/* Tool / outcome / country breakdowns. md collapses to 2-up, lg
			    spreads to a 3-up row — each card stays comfortably wide
			    enough for its longest label (e.g. "Rate-limited" or a
			    full country name + flag). */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				<BreakdownCard
					title="By tool"
					subtitle="Last 24 hours"
					rows={[
						{
							label: 'Background',
							count: stats.by_tool.background,
							color: '#6366f1',
						},
						{
							label: 'Upscale',
							count: stats.by_tool.upscale,
							color: '#0ea5e9',
						},
						{
							label: 'Expand',
							count: stats.by_tool.expand,
							color: '#14b8a6',
						},
					]}
				/>
				<BreakdownCard
					title="By outcome"
					subtitle="Last 24 hours"
					rows={[
						{
							label: 'Accepted',
							count: stats.by_outcome.accepted,
							color: '#10b981',
							hint: `${acceptedPct}% of all requests`,
						},
						{
							label: 'Bot blocked',
							count: stats.by_outcome.bot_blocked,
							color: '#8b5cf6',
						},
						{
							label: 'Rate-limited',
							count: stats.by_outcome.rate_limited,
							color: '#f59e0b',
						},
						{
							label: 'Failed',
							count: stats.by_outcome.failed,
							color: '#ef4444',
						},
					]}
				/>
				<CountryBreakdownCard countries={stats.by_country} />
			</div>

			{/* IPs + recent activity */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
				<div className="lg:col-span-2">
					<TopIpsCard count={stats.unique_ips_24h} top={stats.top_ips} />
				</div>
				<div className="lg:col-span-3">
					<RecentActivityCard events={stats.recent} />
				</div>
			</div>
		</>
	);
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Card primitives                                                           *
 * ──────────────────────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: number }) {
	return (
		<div className="card-floating p-5">
			<div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
				{label}
			</div>
			<div className="mt-1 text-[30px] font-semibold leading-none tabular-nums text-[var(--color-ink)]">
				{formatCount(value)}
			</div>
			<div className="mt-2 text-[12px] text-[var(--color-ink-muted)]">
				{value === 1 ? 'transformation' : 'transformations'}
			</div>
		</div>
	);
}

function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
	return (
		<div>
			<h2 className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</h2>
			{subtitle && (
				<p className="mt-0.5 text-[12px] text-[var(--color-ink-muted)]">{subtitle}</p>
			)}
		</div>
	);
}

function BreakdownCard({
	title,
	subtitle,
	rows,
	emptyMessage,
}: {
	title: string;
	subtitle?: string;
	rows: { label: string; count: number; color: string; hint?: string }[];
	/** Shown when `rows` is empty. Defaults to nothing (card body collapses). */
	emptyMessage?: string;
}) {
	const total = rows.reduce((acc, r) => acc + r.count, 0);
	return (
		<div className="card-floating p-5">
			<CardHeader title={title} subtitle={subtitle} />
			{rows.length === 0 ? (
				emptyMessage && (
					<p className="mt-4 text-[12.5px] text-[var(--color-ink-muted)]">
						{emptyMessage}
					</p>
				)
			) : (
				<ul className="mt-4 space-y-3.5">
					{rows.map((row) => {
						const pct = total > 0 ? (row.count / total) * 100 : 0;
						return (
							<li key={row.label}>
								<div className="flex items-baseline justify-between gap-2 text-[13px]">
									{/* min-w-0 + flex-1 lets the label shrink and
									    truncate instead of pushing the count off
									    the right edge. Country names can be long
									    ("Democratic Republic of the Congo"). */}
									<span className="min-w-0 flex-1 truncate font-medium text-[var(--color-ink)]">
										{row.label}
									</span>
									<span className="shrink-0 tabular-nums text-[var(--color-ink-muted)]">
										{formatCount(row.count)}
										<span className="ml-1.5 text-[11px] text-[var(--color-ink-subtle)]">
											{total > 0 ? `${Math.round(pct)}%` : ''}
										</span>
									</span>
								</div>
								<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-hover)]">
									<div
										className="h-full transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]"
										style={{
											width: `${pct}%`,
											backgroundColor: row.color,
										}}
									/>
								</div>
								{row.hint && (
									<div className="mt-1 text-[11.5px] text-[var(--color-ink-subtle)]">
										{row.hint}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

/**
 * Country breakdown — a BreakdownCard wrapped to format ISO codes into
 * "🇬🇧 United Kingdom" labels. Uses a single neutral slate colour for all
 * bars since the countries don't have categorical meaning the way tools or
 * outcomes do — the bar length alone communicates the magnitude.
 */
function CountryBreakdownCard({ countries }: { countries: CountryStat[] }) {
	return (
		<BreakdownCard
			title="By country"
			subtitle="Last 24 hours"
			emptyMessage="No data yet."
			rows={countries.map((c) => ({
				label: countryLabel(c.country),
				count: c.count,
				color: '#64748b', // slate-500
			}))}
		/>
	);
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Hourly chart                                                              *
 * ──────────────────────────────────────────────────────────────────────── */

function HourlyChart({ buckets }: { buckets: HourlyBucket[] }) {
	const max = Math.max(1, ...buckets.map((b) => b.count));
	const lastIdx = buckets.length - 1;
	return (
		<div className="mt-4">
			<div className="flex h-32 items-end gap-[3px]">
				{buckets.map((bucket, i) => {
					const heightPct = max > 0 ? (bucket.count / max) * 100 : 0;
					const isLatest = i === lastIdx;
					const empty = bucket.count === 0;
					return (
						<div
							key={bucket.hour}
							className="group relative h-full flex-1"
							title={`${formatChartHour(bucket.hour)} — ${formatCount(bucket.count)} ${
								bucket.count === 1 ? 'request' : 'requests'
							}`}
						>
							<div
								className={clsx(
									'absolute right-0 bottom-0 left-0 rounded-t-[3px]',
									'transition-[height,background-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)]',
									empty
										? 'bg-[var(--color-surface-active)]'
										: isLatest
											? 'bg-[var(--color-brand)]'
											: 'bg-[var(--color-brand)]/70 group-hover:bg-[var(--color-brand)]',
								)}
								style={{
									// 2px minimum for non-empty bars so they're visible.
									height: empty ? '2px' : `max(4px, ${heightPct}%)`,
								}}
							/>
						</div>
					);
				})}
			</div>
			<div className="mt-2 flex justify-between text-[10px] tabular-nums text-[var(--color-ink-subtle)]">
				<span>24h ago</span>
				<span>12h ago</span>
				<span>Now</span>
			</div>
		</div>
	);
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Top IPs + Recent activity                                                 *
 * ──────────────────────────────────────────────────────────────────────── */

function TopIpsCard({ count, top }: { count: number; top: TopIp[] }) {
	return (
		<div className="card-floating p-5">
			<CardHeader title="Unique IPs" subtitle="Last 24 hours" />
			<div className="mt-3 text-[30px] font-semibold leading-none tabular-nums text-[var(--color-ink)]">
				{formatCount(count)}
			</div>

			{top.length > 0 ? (
				<>
					<h3 className="mt-6 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
						Top requesters
					</h3>
					<ul className="mt-2 divide-y divide-[var(--color-line)]">
						{top.map((row) => (
							<li
								key={row.ip}
								className="flex items-center justify-between gap-2 py-2 text-[13px]"
							>
								<span className="truncate font-mono text-[12px] text-[var(--color-ink)]">
									{row.ip}
								</span>
								<span className="shrink-0 tabular-nums text-[var(--color-ink-muted)]">
									{formatCount(row.count)}
									<span className="ml-2 text-[11px] text-[var(--color-ink-subtle)]">
										<LiveAgo ts={row.last_seen} />
									</span>
								</span>
							</li>
						))}
					</ul>
				</>
			) : (
				<p className="mt-6 text-[12.5px] text-[var(--color-ink-muted)]">
					No activity in the last 24 hours.
				</p>
			)}
		</div>
	);
}

function RecentActivityCard({ events }: { events: RecentEvent[] }) {
	return (
		<div className="card-floating flex h-full flex-col p-5">
			<CardHeader title="Recent activity" subtitle="Last 50 requests" />
			{events.length === 0 ? (
				<p className="mt-6 text-[12.5px] text-[var(--color-ink-muted)]">
					Nothing recorded yet.
				</p>
			) : (
				<ul className="mt-3 max-h-[440px] flex-1 divide-y divide-[var(--color-line)] overflow-y-auto">
					{events.map((event, i) => (
						<li
							key={`${event.ts}-${i}`}
							className="grid grid-cols-[1fr_auto] items-center gap-x-3 py-2.5"
						>
							<div className="min-w-0">
								<div className="flex items-center gap-2 text-[13px]">
									<ToolBadge tool={event.tool} />
									<OutcomeBadge outcome={event.outcome} />
								</div>
								<div className="mt-1 truncate text-[11.5px] text-[var(--color-ink-muted)]">
									<span className="font-mono">{event.ip}</span>
									{event.country && (
										<>
											<span className="mx-1.5 text-[var(--color-ink-subtle)]">
												·
											</span>
											{/* Flag + 2-letter code keeps each row
											    short while still giving the admin an
											    at-a-glance signal of the location. */}
											{(() => {
												const flag = flagEmoji(event.country);
												return flag
													? `${flag} ${event.country}`
													: event.country;
											})()}
										</>
									)}
								</div>
							</div>
							<div className="shrink-0 text-right text-[11.5px] tabular-nums text-[var(--color-ink-muted)]">
								<LiveAgo ts={event.ts} />
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ToolBadge({ tool }: { tool: Tool }) {
	const meta = TOOL_META[tool];
	return (
		<span
			className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
			style={{
				color: meta.fg,
				backgroundColor: meta.bg,
			}}
		>
			{meta.label}
		</span>
	);
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
	const meta = OUTCOME_META[outcome];
	return (
		<span
			className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
			style={{
				color: meta.fg,
				backgroundColor: meta.bg,
			}}
		>
			{meta.label}
		</span>
	);
}

const TOOL_META: Record<Tool, { label: string; fg: string; bg: string }> = {
	background: { label: 'Background', fg: '#4338ca', bg: '#eef2ff' },
	upscale: { label: 'Upscale', fg: '#0369a1', bg: '#e0f2fe' },
	expand: { label: 'Expand', fg: '#0f766e', bg: '#ccfbf1' },
};

const OUTCOME_META: Record<Outcome, { label: string; fg: string; bg: string }> = {
	accepted: { label: 'Accepted', fg: '#047857', bg: '#d1fae5' },
	bot_blocked: { label: 'Bot blocked', fg: '#5b21b6', bg: '#ede9fe' },
	rate_limited: { label: 'Rate-limited', fg: '#92400e', bg: '#fef3c7' },
	failed: { label: 'Failed', fg: '#b91c1c', bg: '#fee2e2' },
};

/* ──────────────────────────────────────────────────────────────────────── *
 * Formatting / helpers                                                      *
 * ──────────────────────────────────────────────────────────────────────── */

function formatCount(n: number): string {
	return n.toLocaleString();
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Country formatting                                                        *
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Convert a 2-letter ISO 3166-1 alpha-2 country code into a regional
 * indicator emoji ("US" → "🇺🇸"). Regional indicator symbols live at
 * U+1F1E6 ('A') through U+1F1FF ('Z'), so the offset from an ASCII letter
 * is 0x1F1E6 - 0x41 = 0x1F1A5. Returns an empty string for non-letter or
 * sentinel codes ("Unknown" / "Other") so the caller can fall back gracefully.
 */
function flagEmoji(code: string): string {
	if (!/^[A-Z]{2}$/.test(code)) return '';
	return String.fromCodePoint(0x1f1a5 + code.charCodeAt(0), 0x1f1a5 + code.charCodeAt(1));
}

// One shared Intl.DisplayNames instance — constructing one is non-trivial
// and the formatter is locale-immutable for our purposes (English regions).
// Wrapped in a null fallback because very old browsers may not have it; the
// caller falls back to the raw code in that case.
const REGION_NAMES: Intl.DisplayNames | null = (() => {
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' });
	} catch {
		return null;
	}
})();

/**
 * Look up the English name for a country code. Returns the code itself if
 * the lookup fails (unknown codes, missing API). Pass-throughs apply to our
 * sentinel "Unknown" / "Other" labels too.
 */
function countryName(code: string): string {
	if (code === 'Unknown' || code === 'Other') return code;
	try {
		return REGION_NAMES?.of(code) ?? code;
	} catch {
		return code;
	}
}

/**
 * Full label for the country breakdown chart: "🇬🇧 United Kingdom". Falls
 * back to just the name (no flag) if the code isn't a real 2-letter ISO
 * value — covers our "Unknown" / "Other" buckets and any weird CF-injected
 * values.
 */
function countryLabel(code: string): string {
	const flag = flagEmoji(code);
	const name = countryName(code);
	return flag ? `${flag} ${name}` : name;
}

/** Compact relative time: "12s ago", "4m ago", "2h ago", "3d ago". */
function formatAgo(ts: number, now: number): string {
	const sec = Math.max(0, Math.floor((now - ts) / 1000));
	if (sec < 5) return 'just now';
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const days = Math.floor(hr / 24);
	return `${days}d ago`;
}

/** Format an hour-bucket timestamp for the chart tooltip. */
function formatChartHour(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleString([], {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	});
}

/**
 * Live-updating "X ago" label. Re-renders once a second so the times in the
 * recent-activity list stay current without us having to refetch.
 */
function LiveAgo({ ts }: { ts: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, []);
	return <>{formatAgo(ts, now)}</>;
}

function InlineSpinner() {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
			<circle
				cx="7"
				cy="7"
				r="5.5"
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.25"
				strokeWidth="1.5"
			/>
			<path
				d="M12.5 7a5.5 5.5 0 0 0-5.5-5.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			>
				<animateTransform
					attributeName="transform"
					type="rotate"
					from="0 7 7"
					to="360 7 7"
					dur="0.9s"
					repeatCount="indefinite"
				/>
			</path>
		</svg>
	);
}
