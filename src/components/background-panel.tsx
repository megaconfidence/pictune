import clsx from 'clsx';
import { formatElapsed, useElapsed } from '../hooks';
import type { ImageState } from '../types';

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
 * Right-hand panel shown when the Background tool is active.
 *
 * There are no model knobs to turn (bria/remove-background has only a single
 * `preserve_alpha` flag, which we hard-pin to true so the user keeps the
 * cutout transparency), so the panel is just a primary action plus a status
 * readout. Keeping the same panel shape as Expand / Upscale gives the right
 * side of the editor a consistent rhythm regardless of which tool is active.
 *
 * Background removal does NOT auto-run on upload — the user opts in by
 * pressing this button, matching the other two tools.
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
			className="card-floating w-[260px] flex-shrink-0 p-4"
			aria-label="Background settings"
		>
			<h2 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Background</h2>

			<button
				type="button"
				onClick={onRun}
				disabled={processing}
				className={clsx(
					'mb-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-semibold text-white',
					'bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]',
					'transition-[background-color,scale] duration-150 active:scale-[0.98]',
					'disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-[var(--color-brand)]',
					'focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)] focus-visible:outline-none',
				)}
			>
				{processing && <InlineSpinner />}
				{/*
				 * Short label during processing — "Removing background…" + the
				 * elapsed badge would wrap and break the button layout in this
				 * 260-px panel. The canvas-centered ProcessingBadge already
				 * spells out the full action ("Removing background… 0:15") with
				 * plenty of room, so the button just needs to confirm activity.
				 */}
				<span>{processing ? 'Removing…' : hasResult ? 'Re-run' : 'Run'}</span>
				{showElapsed && (
					<span className="tabular-nums text-white/80">
						{formatElapsed(elapsedMs)}
					</span>
				)}
			</button>

			<div className="mt-1 text-center text-[12px] leading-snug text-[var(--color-ink-muted)]">
				{hasResult ? (
					<span>
						Output{' '}
						<span className="tabular-nums font-semibold text-[var(--color-ink)]">
							{result.width}×{result.height}
						</span>
					</span>
				) : (
					<span>Ready to run</span>
				)}
			</div>
		</div>
	);
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
				strokeOpacity="0.3"
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
