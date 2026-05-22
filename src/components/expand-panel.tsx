import clsx from 'clsx';
import { ChevronDown, Frame, Link2, Link2Off } from 'lucide-react';
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
import { PanelHeader, PanelStatus, PrimaryCTA } from './background-panel';
import { FieldLabel } from './upscale-panel';

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
	'1:1': 'Square — 1:1',
	'16:9': 'Widescreen — 16:9',
	'9:16': 'Portrait — 9:16',
	'3:2': 'Photo — 3:2',
	'2:3': 'Photo tall — 2:3',
	'4:3': 'Classic — 4:3',
	'3:4': 'Classic tall — 3:4',
	'4:5': 'Social — 4:5',
	'5:4': 'Social wide — 5:4',
};

const CHOICES: AspectRatioChoice[] = ['custom', ...ASPECT_RATIO_PRESETS];

/**
 * Right-hand panel for the Expand tool.
 *
 * The bria/expand-image model only accepts one of nine fixed aspect
 * ratios, not arbitrary canvas dimensions. The panel surfaces that
 * honestly:
 *
 *   - Picking a named preset (1:1, 16:9, …) auto-populates W and H with
 *     the dimensions the model will actually produce for the source.
 *   - Picking "Custom" lets the user type any W and H. We snap to the
 *     nearest supported ratio at submit time; the status pill shows
 *     which preset will actually be applied ("Will apply 16:9").
 *   - The chain icon between W and H controls proportional editing —
 *     only meaningful in Custom mode (preset modes hard-lock the ratio).
 *
 * Generate is the primary action; nothing auto-runs because each call
 * costs Replicate credits.
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
	 * The preset that will actually be sent to the model. For Custom
	 * mode, snap to the nearest enum based on the user's W/H ratio.
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
			className="card-floating w-[260px] flex-shrink-0 p-5 animate-rise"
			style={{ animationDelay: '160ms' }}
			aria-label="Expand settings"
		>
			<PanelHeader Icon={Frame} title="Expand" subtitle="Grow the canvas" />

			<FieldLabel>Aspect ratio</FieldLabel>
			<div className="relative">
				<select
					name="aspect-ratio"
					aria-label="Aspect ratio preset"
					value={settings.choice}
					disabled={processing}
					onChange={(e) => selectChoice(e.target.value as AspectRatioChoice)}
					className={clsx(
						'h-10 w-full appearance-none rounded-[10px] pr-9 pl-3 text-left text-[13px] font-medium',
						'bg-[var(--color-surface-soft)] text-[var(--color-ink)]',
						'transition-[background-color] duration-150',
						'hover:bg-[var(--color-surface-press)]',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)]',
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

			<FieldLabel>Dimensions</FieldLabel>
			<div className="flex items-center gap-1.5">
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
					title={settings.linked ? 'Unlink' : 'Link'}
					className={clsx(
						'grid h-9 w-9 flex-shrink-0 place-items-center rounded-[8px]',
						'transition-[background-color,color] duration-150',
						'hover:bg-[var(--color-surface-soft)]',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)]',
						'disabled:cursor-not-allowed disabled:opacity-50',
						settings.linked
							? 'text-[var(--color-brand)]'
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

			<PrimaryCTA processing={processing} onClick={() => onGenerate(effectivePreset)}>
				{processing ? 'Expanding…' : hasResult ? 'Run again' : 'Expand canvas'}
				{showElapsed && (
					<span className="tabular-nums text-white/80">{formatElapsed(elapsedMs)}</span>
				)}
			</PrimaryCTA>

			{/*
			 * Status. Three states:
			 *   - With a result: show actual output dimensions.
			 *   - Custom mode with non-preset ratio: show the snap target.
			 *   - Default: show the effective preset.
			 */}
			<PanelStatus>
				{hasResult ? (
					<>
						<span className="text-[var(--color-ink-muted)]">Output</span>
						<span className="tabular-nums font-medium text-[var(--color-ink)]">
							{result.width}×{result.height}
						</span>
					</>
				) : showSnapHint ? (
					<>
						<span className="text-[var(--color-ink-muted)]">Will apply</span>
						<span className="font-medium text-[var(--color-ink)]">
							{effectivePreset}
						</span>
					</>
				) : (
					<>
						<span className="text-[var(--color-ink-muted)]">Target</span>
						<span className="font-medium text-[var(--color-ink)]">
							{effectivePreset}
						</span>
					</>
				)}
			</PanelStatus>
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
 * One of the two W/H number inputs. Leading caps-label lives inside the
 * pill so the input feels like a single styled control.
 *
 * Uses `onChange` with NaN-guard rather than `onBlur` so the linked
 * proportional update tracks the input value live.
 */
function DimensionInput({ id, label, value, disabled, onChange }: DimensionInputProps) {
	return (
		<label
			htmlFor={id}
			className={clsx(
				'flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] px-2.5',
				'bg-[var(--color-surface-soft)]',
				'transition-[background-color] duration-150',
				'focus-within:ring-2 focus-within:ring-[var(--color-brand-ring)]',
				disabled && 'opacity-50',
			)}
		>
			<span
				className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-[var(--color-ink-subtle)]"
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

/* ──────────────────────────────────────────────────────────────────────── *
 * Helpers                                                                   *
 * ──────────────────────────────────────────────────────────────────────── */

/** Keep W/H within sensible bounds. The model caps at 5000 per docs. */
function clampDimension(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(1, Math.min(5000, Math.round(value)));
}

/**
 * True when the typed W:H *is* already the given preset (within 0.5%
 * tolerance). Used to decide whether to show the "will apply" hint — if
 * the user's typed dimensions exactly match the snap target, no hint
 * needed.
 */
function presetMatchesRatio(preset: AspectRatioPreset, width: number, height: number): boolean {
	if (width <= 0 || height <= 0) return false;
	const typed = width / height;
	const [rw, rh] = parseRatio(preset);
	const presetRatio = rw / rh;
	return Math.abs(typed - presetRatio) / presetRatio < 0.005;
}
