import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { formatElapsed, useElapsed } from '../hooks';
import type { ImageState, UpscaleSettings } from '../types';

interface UpscalePanelProps {
	image: ImageState;
	settings: UpscaleSettings;
	processing: boolean;
	/** Timestamp (ms since epoch) of when the current job started, or null. */
	processingStartedAt: number | null;
	hasResult: boolean;
	onChangeSettings: (next: UpscaleSettings) => void;
	onRetry: () => void;
}

/** Hide the live counter for the first couple of seconds — it's just noise. */
const ELAPSED_VISIBLE_AFTER_MS = 3000;

/**
 * Right-hand panel shown when the Upscale tool is active.
 *
 *   - Title "Upscale"
 *   - Fast / Quality dropdown (visual only — we mock with a styled <select>)
 *   - 2x / 4x segmented toggle
 *   - Full-width "Retry" button. Doubles as the loading affordance while a
 *     prediction is in flight — disabled, label changes to "Upscaling…".
 *   - Dimensions row: original → upscaled, both tabular-nums
 *
 * Changing the dropdown or factor does NOT auto-run — by design, because
 * each call costs real money. The user opts in by clicking Retry.
 */
export function UpscalePanel({
	image,
	settings,
	processing,
	processingStartedAt,
	hasResult,
	onChangeSettings,
	onRetry,
}: UpscalePanelProps) {
	const upscaledWidth = image.width * settings.factor;
	const upscaledHeight = image.height * settings.factor;
	const elapsedMs = useElapsed(processingStartedAt);
	const showElapsed = processing && elapsedMs >= ELAPSED_VISIBLE_AFTER_MS;

	return (
		<div
			className="card-floating w-[260px] flex-shrink-0 p-4"
			aria-label="Upscale settings"
		>
			<h2 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Upscale</h2>

			<div className="relative mb-2">
				<select
					name="upscale-mode"
					aria-label="Upscale mode"
					value={settings.mode}
					disabled={processing}
					onChange={(e) =>
						onChangeSettings({
							...settings,
							mode: e.target.value as UpscaleSettings['mode'],
						})
					}
					className={clsx(
						'h-11 w-full appearance-none rounded-lg pr-9 pl-3.5 text-left text-[14px] font-medium',
						'bg-[var(--color-surface-hover)] text-[var(--color-ink)]',
						'transition-[background-color,box-shadow] duration-150',
						'hover:bg-[var(--color-surface-active)]',
						'focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:outline-none',
						'disabled:opacity-50',
					)}
				>
					<option value="fast">Fast Upscale</option>
					<option value="quality">Quality Upscale</option>
				</select>
				<ChevronDown
					className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-muted)]"
					strokeWidth={2}
				/>
			</div>

			<div
				role="radiogroup"
				aria-label="Upscale factor"
				className="mb-3 grid grid-cols-2 gap-0.5 rounded-lg bg-[var(--color-surface-hover)] p-0.5"
			>
				{([2, 4] as const).map((factor) => {
					const active = settings.factor === factor;
					return (
						<button
							key={factor}
							role="radio"
							aria-checked={active}
							disabled={processing}
							onClick={() => onChangeSettings({ ...settings, factor })}
							className={clsx(
								'relative h-9 rounded-md text-[14px] font-semibold transition-[background-color,color,box-shadow,scale] duration-150',
								'ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.97]',
								'disabled:cursor-not-allowed disabled:opacity-60',
								active
									? 'bg-white text-[var(--color-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]'
									: 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
							)}
						>
							{factor}x
						</button>
					);
				})}
			</div>

			<button
				onClick={onRetry}
				disabled={processing}
				className={clsx(
					'mb-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-medium',
					'bg-[var(--color-surface-hover)] text-[var(--color-ink)]',
					'transition-[background-color,scale] duration-150 active:scale-[0.98]',
					'hover:bg-[var(--color-surface-active)]',
					'disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-[var(--color-surface-hover)]',
					'focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:outline-none',
				)}
			>
				{processing && <InlineSpinner />}
				<span>{processing ? 'Upscaling…' : hasResult ? 'Retry' : 'Run upscale'}</span>
				{showElapsed && (
					<span className="tabular-nums text-[var(--color-ink-muted)]">
						{formatElapsed(elapsedMs)}
					</span>
				)}
			</button>

			{/* Dimensions: 1200×1200 → 2400×2400 */}
			<div className="flex items-center justify-center gap-2 text-[13px]">
				<span className="tabular-nums text-[var(--color-ink-muted)]">
					{image.width}×{image.height}
				</span>
				<svg
					width="16"
					height="16"
					viewBox="0 0 16 16"
					aria-hidden
					className="text-[var(--color-ink-muted)]"
				>
					<path
						d="M3 8H13M13 8L9 4M13 8L9 12"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span className="tabular-nums font-semibold text-[var(--color-ink)]">
					{upscaledWidth}×{upscaledHeight}
				</span>
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
				strokeOpacity="0.18"
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
