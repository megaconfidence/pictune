import clsx from 'clsx';
import { ChevronDown, Sparkles } from 'lucide-react';
import { formatElapsed, useElapsed } from '../hooks';
import type { ImageState, UpscaleSettings } from '../types';
import { PanelHeader, PanelStatus, PrimaryCTA } from './background-panel';

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
 * Right-hand panel for the Upscale tool.
 *
 *   - Fast / Quality dropdown (faithful vs add-detail).
 *   - 2× / 4× segmented toggle on a soft-gray track.
 *   - Teal CTA. Doubles as the loading affordance — disabled, label
 *     changes to "Upscaling…" with elapsed counter once it crosses 3s.
 *   - Status pill: source → upscaled dimensions, tabular nums so the
 *     digits never shift between runs.
 *
 * Changing the dropdown or factor does NOT auto-run — by design, each
 * call costs Replicate credits. The user opts in via the CTA.
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
			className="card-floating w-[260px] flex-shrink-0 p-5 animate-rise"
			style={{ animationDelay: '160ms' }}
			aria-label="Upscale settings"
		>
			<PanelHeader Icon={Sparkles} title="Upscale" subtitle="Sharpen and enlarge" />

			<FieldLabel>Mode</FieldLabel>
			<div className="relative">
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
						'h-10 w-full appearance-none rounded-[10px] pr-9 pl-3 text-left text-[13px] font-medium',
						'bg-[var(--color-surface-soft)] text-[var(--color-ink)]',
						'transition-[background-color] duration-150',
						'hover:bg-[var(--color-surface-press)]',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)]',
						'disabled:opacity-50',
					)}
				>
					<option value="fast">Fast — keep it faithful</option>
					<option value="quality">Quality — add detail</option>
				</select>
				<ChevronDown
					className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-muted)]"
					strokeWidth={2}
				/>
			</div>

			<FieldLabel>Factor</FieldLabel>
			<div
				role="radiogroup"
				aria-label="Upscale factor"
				className="grid grid-cols-2 gap-0.5 rounded-[10px] bg-[var(--color-surface-soft)] p-0.5"
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
								'relative h-9 rounded-[8px] text-[13px] font-medium',
								'transition-[background-color,color,box-shadow,scale] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.97]',
								'disabled:cursor-not-allowed disabled:opacity-60',
								active
									? 'bg-white text-[var(--color-ink)] shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.04)]'
									: 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
							)}
						>
							{factor}×
						</button>
					);
				})}
			</div>

			<PrimaryCTA processing={processing} onClick={onRetry}>
				{processing ? 'Upscaling…' : hasResult ? 'Run again' : 'Upscale'}
				{showElapsed && (
					<span className="tabular-nums text-white/80">{formatElapsed(elapsedMs)}</span>
				)}
			</PrimaryCTA>

			<PanelStatus>
				<span className="tabular-nums text-[var(--color-ink-muted)]">
					{image.width}×{image.height}
				</span>
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					aria-hidden
					className="text-[var(--color-ink-subtle)]"
				>
					<path
						d="M3 8H13M13 8L9 4M13 8L9 12"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span className="tabular-nums font-medium text-[var(--color-ink)]">
					{upscaledWidth}×{upscaledHeight}
				</span>
			</PanelStatus>
		</div>
	);
}

/**
 * Section label above each field. Small caps + wide tracking gives a
 * quiet hierarchy without taking up much space.
 */
export function FieldLabel({ children }: { children: React.ReactNode }) {
	return (
		<p className="mt-4 mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
			{children}
		</p>
	);
}
