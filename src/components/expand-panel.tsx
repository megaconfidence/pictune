import clsx from 'clsx';
import { ChevronDown, Link2, Link2Off } from 'lucide-react';
import { useId, useMemo } from 'react';
import { formatElapsed, useElapsed } from '../hooks';
import {
	ASPECT_RATIO_PRESETS,
	type AspectRatioChoice,
	type AspectRatioPreset,
	expandDimensionsForRatio,
	type ExpandSettings,
	type ImageState,
	parseRatio,
	snapToNearestPreset,
} from '../types';

interface ExpandPanelProps {
	image: ImageState;
	settings: ExpandSettings;
	processing: boolean;
	/** Timestamp (ms since epoch) of when the current job started, or null. */
	processingStartedAt: number | null;
	/** The most recent expand result, if any — used to show actual output dims. */
	result: ImageState | null;
	onChangeSettings: (next: ExpandSettings) => void;
	onGenerate: (effectiveRatio: AspectRatioPreset) => void;
}

const ELAPSED_VISIBLE_AFTER_MS = 3000;

/** What the dropdown displays for each option. */
const CHOICE_LABEL: Record<AspectRatioChoice, string> = {
	custom: 'Custom',
	'1:1': '1:1',
	'16:9': '16:9',
	'9:16': '9:16',
	'3:2': '3:2',
	'2:3': '2:3',
	'4:3': '4:3',
	'3:4': '3:4',
	'4:5': '4:5',
	'5:4': '5:4',
};

const CHOICES: AspectRatioChoice[] = ['custom', ...ASPECT_RATIO_PRESETS];

/**
 * Right-hand panel shown when the Expand tool is active.
 *
 * The bria/expand-image model only accepts one of nine fixed aspect ratios,
 * not arbitrary canvas dimensions. We surface that honestly:
 *
 *   - Picking a named preset (1:1, 16:9, …) auto-populates W and H with the
 *     dimensions the model will return for the current source.
 *   - Picking "Custom" lets the user type whatever W and H they want, and we
 *     snap to the nearest supported ratio at submit time. The hint label
 *     under the inputs shows which preset will actually be applied.
 *   - The chain icon between W and H controls proportional editing — only
 *     meaningful in Custom mode (preset modes hard-lock the ratio).
 *
 * Generate is the primary action and never auto-fires — each call costs
 * Replicate credits, same as Upscale.
 */
export function ExpandPanel({
	image,
	settings,
	processing,
	processingStartedAt,
	result,
	onChangeSettings,
	onGenerate,
}: ExpandPanelProps) {
	const widthId = useId();
	const heightId = useId();
	const elapsedMs = useElapsed(processingStartedAt);
	const showElapsed = processing && elapsedMs >= ELAPSED_VISIBLE_AFTER_MS;
	const hasResult = result != null;

	/**
	 * The preset that will actually be sent to the model. For Custom mode,
	 * snap to the nearest enum based on the user's W/H ratio.
	 */
	const effectivePreset: AspectRatioPreset = useMemo(() => {
		if (settings.choice === 'custom') {
			return snapToNearestPreset(settings.width, settings.height);
		}
		return settings.choice;
	}, [settings.choice, settings.width, settings.height]);

	/* ── Handlers ─────────────────────────────────────────────────────── */

	function selectChoice(choice: AspectRatioChoice) {
		if (choice === 'custom') {
			onChangeSettings({ ...settings, choice: 'custom' });
			return;
		}
		const [rw, rh] = parseRatio(choice);
		const dims = expandDimensionsForRatio(image.width, image.height, rw, rh);
		onChangeSettings({
			choice,
			width: dims.width,
			height: dims.height,
			linked: true,
		});
	}

	function updateWidth(rawWidth: number) {
		const nextWidth = clampDimension(rawWidth);
		const nextHeight = settings.linked
			? Math.round(settings.height * (nextWidth / Math.max(1, settings.width)))
			: settings.height;
		onChangeSettings({
			// Free-form edits flip back to Custom — keeps the dropdown honest.
			choice: 'custom',
			width: nextWidth,
			height: clampDimension(nextHeight),
			linked: settings.linked,
		});
	}

	function updateHeight(rawHeight: number) {
		const nextHeight = clampDimension(rawHeight);
		const nextWidth = settings.linked
			? Math.round(settings.width * (nextHeight / Math.max(1, settings.height)))
			: settings.width;
		onChangeSettings({
			choice: 'custom',
			width: clampDimension(nextWidth),
			height: nextHeight,
			linked: settings.linked,
		});
	}

	function toggleLinked() {
		onChangeSettings({ ...settings, linked: !settings.linked });
	}

	const showSnapHint =
		settings.choice === 'custom' &&
		!presetMatchesRatio(effectivePreset, settings.width, settings.height);

	return (
		<div
			className="card-floating w-[260px] flex-shrink-0 p-4"
			aria-label="Expand settings"
		>
			<h2 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Aspect Ratio</h2>

			<div className="relative mb-3">
				<select
					name="aspect-ratio"
					aria-label="Aspect ratio preset"
					value={settings.choice}
					disabled={processing}
					onChange={(e) => selectChoice(e.target.value as AspectRatioChoice)}
					className={clsx(
						'h-11 w-full appearance-none rounded-lg pr-9 pl-3.5 text-left text-[14px] font-medium',
						'bg-[var(--color-surface-hover)] text-[var(--color-ink)]',
						'transition-[background-color,box-shadow] duration-150',
						'hover:bg-[var(--color-surface-active)]',
						'focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:outline-none',
						'disabled:opacity-50',
					)}
				>
					{CHOICES.map((choice) => (
						<option key={choice} value={choice}>
							{CHOICE_LABEL[choice]}
						</option>
					))}
				</select>
				<ChevronDown
					className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-muted)]"
					strokeWidth={2}
				/>
			</div>

			<div className="mb-3 flex items-center gap-2">
				<DimensionInput
					id={widthId}
					label="W"
					value={settings.width}
					disabled={processing}
					onChange={updateWidth}
				/>

				<button
					type="button"
					onClick={toggleLinked}
					disabled={processing}
					aria-pressed={settings.linked}
					aria-label={settings.linked ? 'Unlink width and height' : 'Link width and height'}
					className={clsx(
						'grid h-9 w-9 flex-shrink-0 place-items-center rounded-md',
						'transition-[background-color,color] duration-150',
						'hover:bg-[var(--color-surface-hover)]',
						'focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:outline-none',
						'disabled:cursor-not-allowed disabled:opacity-50',
						settings.linked
							? 'text-[var(--color-ink)]'
							: 'text-[var(--color-ink-subtle)]',
					)}
				>
					{settings.linked ? (
						<Link2 className="h-4 w-4" strokeWidth={2} />
					) : (
						<Link2Off className="h-4 w-4" strokeWidth={2} />
					)}
				</button>

				<DimensionInput
					id={heightId}
					label="H"
					value={settings.height}
					disabled={processing}
					onChange={updateHeight}
				/>
			</div>

			<button
				type="button"
				onClick={() => onGenerate(effectivePreset)}
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
				<span>{processing ? 'Expanding…' : hasResult ? 'Regenerate' : 'Generate'}</span>
				{showElapsed && (
					<span className="ml-1 tabular-nums text-white/80">
						{formatElapsed(elapsedMs)}
					</span>
				)}
			</button>

			{/*
			 * The model decides the actual output dimensions, so we don't
			 * promise W×H up-front. We surface two pieces of honest info:
			 *
			 *   - In Custom mode, which preset we'll snap to.
			 *   - Once we have a result, the real dimensions it came back at.
			 */}
			<div className="mt-1 text-center text-[12px] leading-snug">
				{hasResult ? (
					<div className="text-[var(--color-ink-muted)]">
						Output{' '}
						<span className="tabular-nums font-semibold text-[var(--color-ink)]">
							{result.width}×{result.height}
						</span>
					</div>
				) : showSnapHint ? (
					<div className="text-[var(--color-ink-muted)]">
						Will apply{' '}
						<span className="font-semibold text-[var(--color-ink)]">
							{effectivePreset}
						</span>{' '}
						aspect ratio
					</div>
				) : (
					<div className="text-[var(--color-ink-muted)]">
						Target{' '}
						<span className="font-semibold text-[var(--color-ink)]">
							{effectivePreset}
						</span>{' '}
						aspect ratio
					</div>
				)}
			</div>
		</div>
	);
}

/* ──────────────────────────────────────────────────────────────────────── *
 * Sub-components                                                            *
 * ──────────────────────────────────────────────────────────────────────── */

interface DimensionInputProps {
	id: string;
	label: 'W' | 'H';
	value: number;
	disabled: boolean;
	onChange: (next: number) => void;
}

/**
 * One of the two W/H number inputs. The leading label lives inside the
 * pill-shaped surface so the input feels like a single styled control.
 *
 * Uses `onBlur` to commit edits — typing into a controlled <input type="number">
 * with parseFloat-on-each-keystroke would clobber the user's value while
 * they're still typing the second digit.
 */
function DimensionInput({ id, label, value, disabled, onChange }: DimensionInputProps) {
	return (
		<label
			htmlFor={id}
			className={clsx(
				'flex h-9 flex-1 items-center gap-2 rounded-md px-2.5',
				'bg-[var(--color-surface-hover)]',
				'focus-within:ring-2 focus-within:ring-[var(--color-brand)]',
				disabled && 'opacity-50',
			)}
		>
			<span
				className="text-[12px] font-medium text-[var(--color-ink-muted)]"
				aria-hidden
			>
				{label}
			</span>
			<input
				id={id}
				type="number"
				inputMode="numeric"
				min={64}
				max={5000}
				step={1}
				value={value}
				disabled={disabled}
				aria-label={label === 'W' ? 'Width' : 'Height'}
				onChange={(e) => {
					const parsed = Number(e.target.value);
					if (Number.isFinite(parsed) && parsed > 0) onChange(parsed);
				}}
				className={clsx(
					'min-w-0 flex-1 bg-transparent text-[13px] font-medium tabular-nums',
					'text-[var(--color-ink)] outline-none',
					'[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
				)}
			/>
		</label>
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

/* ──────────────────────────────────────────────────────────────────────── *
 * Helpers                                                                   *
 * ──────────────────────────────────────────────────────────────────────── */

/** Keep W/H within sensible bounds. The model caps at 5000 per docs. */
function clampDimension(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(1, Math.min(5000, Math.round(value)));
}

/**
 * True when the typed W:H *is* already the given preset (within 0.5% tolerance).
 * Used to decide whether to show the "will apply" hint — if the user's typed
 * dimensions exactly match the snap target, no hint needed.
 */
function presetMatchesRatio(preset: AspectRatioPreset, width: number, height: number): boolean {
	if (width <= 0 || height <= 0) return false;
	const typed = width / height;
	const [rw, rh] = parseRatio(preset);
	const presetRatio = rw / rh;
	return Math.abs(typed - presetRatio) / presetRatio < 0.005;
}
