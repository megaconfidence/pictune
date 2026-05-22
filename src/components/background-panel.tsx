import clsx from 'clsx';
import { Eraser } from 'lucide-react';
import { formatElapsed, useElapsed } from '../hooks';
import type { ImageState } from '../types';
import { InlineSpinner } from './ui';

interface BackgroundPanelProps {
	processing: boolean;
	/** Timestamp (ms since epoch) of when the current job started, or null. */
	processingStartedAt: number | null;
	/** The most recent background-removal result, if any. */
	result: ImageState | null;
	onRun: () => void;
}

/** Hide the live counter for the first couple of seconds — it's just noise. */
const ELAPSED_VISIBLE_AFTER_MS = 3000;

/**
 * Right-hand panel for the Background tool.
 *
 * bria/remove-background has no knobs we expose (preserve_alpha is
 * hard-pinned), so the panel is just a tool header, a CTA, and a status
 * readout. Same skeleton as the other two panels so the right rail
 * keeps a consistent rhythm.
 */
export function BackgroundPanel({
	processing,
	processingStartedAt,
	result,
	onRun,
}: BackgroundPanelProps) {
	const elapsedMs = useElapsed(processingStartedAt);
	const showElapsed = processing && elapsedMs >= ELAPSED_VISIBLE_AFTER_MS;
	const hasResult = result != null;

	return (
		<div
			className="card-floating w-[260px] flex-shrink-0 p-5 animate-rise"
			style={{ animationDelay: '160ms' }}
			aria-label="Background settings"
		>
			<PanelHeader Icon={Eraser} title="Background" subtitle="Cut out the subject" />

			<PrimaryCTA processing={processing} onClick={onRun}>
				{processing ? 'Removing…' : hasResult ? 'Run again' : 'Remove background'}
				{showElapsed && (
					<span className="tabular-nums text-white/80">{formatElapsed(elapsedMs)}</span>
				)}
			</PrimaryCTA>

			<PanelStatus>
				{hasResult ? (
					<>
						<span className="text-[var(--color-ink-muted)]">Output</span>
						<span className="tabular-nums font-medium text-[var(--color-ink)]">
							{result.width}×{result.height}
						</span>
					</>
				) : (
					<span className="text-[var(--color-ink-muted)]">Ready when you are</span>
				)}
			</PanelStatus>
		</div>
	);
}

/**
 * Shared title row for all three tool panels: small icon glyph + title +
 * one-line subtitle. Keeps the rail rhythm steady when the user switches
 * tools.
 */
export function PanelHeader({
	Icon,
	title,
	subtitle,
}: {
	Icon: typeof Eraser;
	title: string;
	subtitle: string;
}) {
	return (
		<div className="flex items-center gap-2.5">
			<span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[8px] bg-[var(--color-surface-soft)] text-[var(--color-ink)]">
				<Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
			</span>
			<div className="min-w-0 flex flex-col leading-tight">
				<h2 className="text-[14px] font-medium text-[var(--color-ink)]">{title}</h2>
				<p className="mt-0.5 text-[11.5px] text-[var(--color-ink-muted)] truncate">
					{subtitle}
				</p>
			</div>
		</div>
	);
}

/**
 * The single primary CTA shared by every tool panel — teal fill, white
 * text, scale-on-press. Encapsulated so the three panels look identical
 * at the button level (which is the level the user interacts with).
 */
export function PrimaryCTA({
	processing,
	onClick,
	children,
}: {
	processing: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={processing}
			className={clsx(
				'mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] text-[13.5px] font-medium text-white',
				'bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]',
				'transition-[background-color,scale] duration-200 active:scale-[0.97]',
				'disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-[var(--color-brand)]',
				'focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] focus-visible:outline-none',
			)}
		>
			{processing && <InlineSpinner />}
			{children}
		</button>
	);
}

/**
 * Subtle status strip at the bottom of each panel. Centered text on a
 * faint gray pill — anchors the bottom edge without competing with the
 * CTA above it.
 */
export function PanelStatus({ children }: { children: React.ReactNode }) {
	return (
		<div className="mt-3 flex items-center justify-center gap-1.5 rounded-[8px] bg-[var(--color-surface-soft)]/70 px-3 py-2 text-[12px] leading-snug">
			{children}
		</div>
	);
}
