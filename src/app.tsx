import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { BackgroundPanel } from './components/background-panel';
import { BottomControls } from './components/bottom-controls';
import { CompareSlider } from './components/compare-slider';
import { DropZone } from './components/drop-zone';
import { ExpandPanel } from './components/expand-panel';
import { Header } from './components/header';
import { ImageViewer } from './components/image-viewer';
import { Sidebar } from './components/sidebar';
import { UpscalePanel } from './components/upscale-panel';
import { usePasteImage } from './hooks';
import { useTurnstile } from './turnstile';
import {
	type AspectRatioPreset,
	blobToImageState,
	type ExpandSettings,
	type ImageState,
	type Step,
	type Tool,
	type UpscaleSettings,
} from './types';

/* ---------------------------------------------------------------------- *
 * Zoom bounds                                                              *
 *                                                                          *
 * Kept module-level so both the imperative wheel handler and the           *
 * declarative button callbacks share one source of truth. The wheel rate   *
 * was tuned by feel: 0.003 makes one mouse-wheel notch (~100 deltaY) feel  *
 * like a step, while trackpad scroll/pinch (smaller deltaY per frame)      *
 * accumulates smoothly without overshooting.                               *
 * ---------------------------------------------------------------------- */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;
const WHEEL_ZOOM_RATE = 0.003;

function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n));
}

/**
 * Top-level container.
 *
 * State model — a linear transformation pipeline ("remix chain"):
 *
 *   original              — the user's upload. Kept as both an ImageState (for
 *                           display) and the raw File (so the first transform
 *                           has something to POST).
 *   steps                 — the chain of applied transformations, in order.
 *                           Each Step holds its OUTPUT as both an ImageState
 *                           and a File; the File of the last step is the INPUT
 *                           to the next one. The tip of this list (or the
 *                           original, when empty) is what the canvas shows.
 *   redoSteps             — steps that have been undone, ready to re-apply.
 *                           Undo moves the tip here; redo moves it back; a new
 *                           transform clears it.
 *   tool                  — which tool's panel is shown, i.e. the next
 *                           operation to apply. It does NOT change what the
 *                           canvas shows — the canvas always shows the tip.
 *   processing            — which tool is currently running, if any. Also
 *                           locks tool switching for the duration.
 *   error                 — last error message.
 *
 * Object-URL lifecycle: any URL we create (via blobToImageState for a step,
 * or directly from the uploaded File) is appended to a Set we revoke en masse
 * on Reset / new upload / unmount. We can't auto-revoke on undo because the
 * redo stack still references those URLs. The Set is bounded in practice
 * (one upload + a few generated images per session).
 */
export default function App() {
	const [tool, setTool] = useState<Tool>('background');
	const [original, setOriginal] = useState<ImageState | null>(null);
	const [originalFile, setOriginalFile] = useState<File | null>(null);

	// The remix chain (undo stack) and the parallel redo stack.
	const [steps, setSteps] = useState<Step[]>([]);
	const [redoSteps, setRedoSteps] = useState<Step[]>([]);

	const [processing, setProcessing] = useState<Tool | null>(null);
	const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [compareActive, setCompareActive] = useState(false);
	const [zoom, setZoom] = useState(1);
	// Translation of the image relative to the canvas viewport (screen
	// pixels). Only meaningful when zoom > 1 — at fit/zoom-out the image
	// is centered by flex and we hold pan at (0,0). The transform on
	// ImageViewer applies translate AFTER scale so dx maps 1:1 to screen
	// pixels regardless of current zoom.
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const [upscaleSettings, setUpscaleSettings] = useState<UpscaleSettings>({
		mode: 'fast',
		factor: 2,
	});
	const [expandSettings, setExpandSettings] = useState<ExpandSettings>({
		choice: 'custom',
		width: 0,
		height: 0,
		linked: true,
	});

	// One AbortController for whatever async API call is currently in flight.
	// Aborting on new run / X-on-running-tool / reset prevents stale state
	// from clobbering what the user actually wants to see.
	const abortRef = useRef<AbortController | null>(null);

	// Cloudflare Turnstile token source. getToken() blocks until the widget
	// has a fresh token ready; we await it inside each run* below so the
	// processing spinner appears immediately and the verification delay
	// (usually <100ms) is folded into the overall progress UI.
	const { getToken: getTurnstileToken } = useTurnstile();

	// All blob/object URLs we own. Revoked on Reset / new upload / unmount.
	// We can't auto-revoke on state change because undo and redo refer back
	// to URLs that are no longer in current state but still need to render.
	const urlsRef = useRef<Set<string>>(new Set());
	const trackUrl = useCallback((url: string) => {
		urlsRef.current.add(url);
	}, []);

	// Revoke everything when the app unmounts.
	useEffect(
		() => () => {
			for (const url of urlsRef.current) URL.revokeObjectURL(url);
			urlsRef.current.clear();
		},
		[],
	);

	/* ------------------------------------------------------------------ *
	 * Chain tip                                                           *
	 * ------------------------------------------------------------------ *
	 *
	 * The tip is the last applied step (or the original upload when the
	 * chain is empty). It is both what the canvas renders and what the next
	 * transform consumes. `tipFile` is mirrored into a ref so the async
	 * run* callbacks can read the current input without listing it as a
	 * dependency (which would rebind them on every step) or closing over a
	 * stale value.
	 */
	const lastStep = steps.length > 0 ? steps[steps.length - 1] : null;
	const lastTool = lastStep?.tool ?? null;
	const tip = lastStep ? lastStep.image : original;
	const tipFile = lastStep ? lastStep.file : originalFile;
	const tipFileRef = useRef(tipFile);
	tipFileRef.current = tipFile;

	// Keep the Expand panel's W/H seeded to the current tip so its inputs and
	// custom-ratio math reflect the image you're actually about to expand.
	// Re-seeds on upload and after every step / undo / redo (tip dims change).
	useEffect(() => {
		if (!tip) return;
		setExpandSettings({
			choice: 'custom',
			width: tip.width,
			height: tip.height,
			linked: true,
		});
	}, [tip?.width, tip?.height]);

	/* ------------------------------------------------------------------ *
	 * Undo / redo                                                         *
	 * ------------------------------------------------------------------ *
	 *
	 * The chain is a linear history: `steps` holds everything applied so far
	 * (the tip is the last entry), `redoSteps` holds what's been undone.
	 * Undo pops the tip onto the redo stack; redo moves it back. A new
	 * transform clears the redo stack (the canonical "new action drops the
	 * forward branch" behaviour). Neither re-runs the API — we just move
	 * cached step results between the two stacks.
	 *
	 * Both stacks are read at call time (not via setState updaters): nesting
	 * a setState inside another setState's updater double-executes under
	 * React StrictMode in dev, silently corrupting the stack.
	 */
	const undo = useCallback(() => {
		if (steps.length === 0) return;
		const popped = steps[steps.length - 1];
		setSteps(steps.slice(0, -1));
		setRedoSteps([...redoSteps, popped]);
		// Compare contrasts original vs tip — the tip just moved, so close it.
		setCompareActive(false);
		setError(null);
	}, [steps, redoSteps]);

	const redo = useCallback(() => {
		if (redoSteps.length === 0) return;
		const popped = redoSteps[redoSteps.length - 1];
		setRedoSteps(redoSteps.slice(0, -1));
		setSteps([...steps, popped]);
		setCompareActive(false);
		setError(null);
	}, [steps, redoSteps]);

	/* ------------------------------------------------------------------ *
	 * File handling                                                       *
	 * ------------------------------------------------------------------ */

	const handleFile = useCallback((file: File) => {
		const url = URL.createObjectURL(file);
		const probe = new Image();
		probe.onload = () => {
			// Free any URLs we owned from a prior session image. We hold
			// off until the new image has decoded so a corrupt upload
			// doesn't wipe out the user's existing state.
			for (const oldUrl of urlsRef.current) URL.revokeObjectURL(oldUrl);
			urlsRef.current = new Set([url]);
			// A new image supersedes anything in flight. This matters now
			// that paste can swap the image mid-session — without the abort
			// a late result from the previous image could land on this one.
			abortRef.current?.abort();
			setProcessing(null);
			setProcessingStartedAt(null);
			setOriginal({
				url,
				name: file.name,
				width: probe.naturalWidth,
				height: probe.naturalHeight,
			});
			setOriginalFile(file);
			// A fresh upload starts a new chain. (Expand settings are seeded
			// from the tip by the effect above, so no need to set them here.)
			setSteps([]);
			setRedoSteps([]);
			setCompareActive(false);
			setZoom(1);
			setPan({ x: 0, y: 0 });
			setError(null);
		};
		probe.onerror = () => URL.revokeObjectURL(url);
		probe.src = url;
	}, []);

	// Paste-to-upload (Cmd/Ctrl+V) anywhere on the page. Routes straight
	// through handleFile, so a pasted screenshot behaves exactly like a
	// dropped or browsed one — including replacing the current image and
	// resetting derived state. handleFile is stable (empty deps), so the
	// listener binds once.
	usePasteImage(handleFile);

	const handleReset = useCallback(() => {
		abortRef.current?.abort();
		for (const url of urlsRef.current) URL.revokeObjectURL(url);
		urlsRef.current.clear();
		setOriginal(null);
		setOriginalFile(null);
		setSteps([]);
		setRedoSteps([]);
		setProcessing(null);
		setProcessingStartedAt(null);
		setError(null);
		setCompareActive(false);
		setZoom(1);
		setPan({ x: 0, y: 0 });
	}, []);

	const handleSelectTool = useCallback(
		(next: Tool) => {
			// Locked while a transform runs so the visible panel and the
			// processing badge can't drift apart from the running tool.
			if (processing !== null) return;
			setTool(next);
			setCompareActive(false);
			setError(null);
		},
		[processing],
	);

	/* ------------------------------------------------------------------ *
	 * Transform pipeline                                                  *
	 * ------------------------------------------------------------------ *
	 *
	 * Every transform consumes the current tip (the last step's file, or the
	 * original upload) and, on success, pushes a new step whose output
	 * becomes the next tip. That feed-the-result-back-in is the whole
	 * "remix" mechanic.
	 *
	 * We deliberately do NOT clear the tip before starting: the ImageViewer
	 * dims it and overlays a spinner, so the canvas reads as "your current
	 * image is being transformed" rather than flashing back to the original.
	 *
	 * On abort (a new run / reset / new upload superseding this one) we bail
	 * before pushing, keeping the chain clean.
	 */
	const runStep = useCallback(
		async (
			stepTool: Tool,
			name: string,
			call: (
				file: File,
				options: { signal: AbortSignal; turnstileToken: string },
			) => Promise<Blob>,
		) => {
			const input = tipFileRef.current;
			if (!input) return;
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setProcessing(stepTool);
			setProcessingStartedAt(Date.now());
			setError(null);
			setCompareActive(false);
			try {
				const turnstileToken = await getTurnstileToken();
				if (controller.signal.aborted) return;
				const blob = await call(input, { signal: controller.signal, turnstileToken });
				if (controller.signal.aborted) return;
				const image = await blobToImageState(blob, name);
				if (controller.signal.aborted) return;
				// Same bytes as `image`, kept as a File so this result can be
				// the input to the next transform in the chain.
				const file = new File([blob], name, { type: blob.type || 'image/png' });
				trackUrl(image.url);
				setSteps((prev) => [...prev, { tool: stepTool, image, file }]);
				setRedoSteps([]);
			} catch (e) {
				if (controller.signal.aborted) return;
				setError(messageFor(e));
			} finally {
				if (!controller.signal.aborted) {
					setProcessing(null);
					setProcessingStartedAt(null);
				}
			}
		},
		[getTurnstileToken, trackUrl],
	);

	const handleRunBackground = useCallback(() => {
		void runStep('background', 'background-removed.png', (file, options) =>
			api.removeBackground(file, options),
		);
	}, [runStep]);

	const handleRunUpscale = useCallback(() => {
		void runStep('upscale', 'upscaled.png', (file, options) =>
			api.upscale(file, upscaleSettings, options),
		);
	}, [runStep, upscaleSettings]);

	const handleRunExpand = useCallback(
		(effectiveRatio: AspectRatioPreset) => {
			void runStep(
				'expand',
				`expanded-${effectiveRatio.replace(':', 'x')}.png`,
				(file, options) => api.expand(file, effectiveRatio, options),
			);
		},
		[runStep],
	);

	/* ------------------------------------------------------------------ *
	 * Download                                                            *
	 * ------------------------------------------------------------------ */

	const downloadCurrent = useCallback(() => {
		if (!tip) return;
		const a = document.createElement('a');
		a.href = tip.url;
		a.download = tip.name;
		document.body.appendChild(a);
		a.click();
		a.remove();
	}, [tip]);

	/* ------------------------------------------------------------------ *
	 * Zoom                                                                *
	 * ------------------------------------------------------------------ *
	 *
	 * Two input paths:
	 *   - Buttons (BottomControls): ±0.1 fixed steps, snapped via toFixed
	 *     so the % readout always lands on clean values (100, 110, 120…).
	 *   - Wheel / trackpad pinch (mainRef effect below): multiplicative
	 *     so the rate of change feels constant at any zoom level. Smooth
	 *     CSS transition is disabled while the wheel is firing so the
	 *     image tracks the gesture 1:1 instead of lagging behind the
	 *     240ms ease curve — re-enabled ~150ms after the wheel stops.
	 *
	 * Range chosen to keep the image useful: 25% (legibly small inside
	 * the viewport) to 300% (close-up without becoming a pixel grid).
	 */

	const zoomIn = useCallback(
		() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))),
		[],
	);
	const zoomOut = useCallback(
		() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))),
		[],
	);
	const fit = useCallback(() => setZoom(1), []);

	// True while no recent wheel activity — drives the 240ms transition
	// on the image scale. Flipped off during wheel for a 1:1 feel.
	const [smoothZoom, setSmoothZoom] = useState(true);
	const mainRef = useRef<HTMLElement>(null);
	const wheelEndTimerRef = useRef<number | null>(null);

	useEffect(() => {
		const el = mainRef.current;
		if (!el) return;

		function handleWheel(e: WheelEvent) {
			// preventDefault stops:
			//   - the browser's native page zoom on trackpad pinch
			//     (which dispatches wheel + ctrlKey)
			//   - the document scroll on plain mouse wheel
			// React's synthetic onWheel is passive in modern React, so
			// this needs to be a native non-passive listener.
			e.preventDefault();

			// deltaY > 0 means user scrolled DOWN / pinched OUT → zoom out.
			// Multiplicative so the rate is constant: at z=0.3 a tick still
			// feels like the same fraction of zoom as at z=2.0.
			// 0.003 chosen by feel: one mouse-wheel notch (deltaY≈100)
			// gives ~1.35× / 0.74×, trackpad scrolls accumulate smoothly.
			const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_RATE);
			setZoom((z) => clamp(z * factor, ZOOM_MIN, ZOOM_MAX));

			// Disable transition while gesture is active.
			setSmoothZoom(false);
			if (wheelEndTimerRef.current !== null) {
				window.clearTimeout(wheelEndTimerRef.current);
			}
			wheelEndTimerRef.current = window.setTimeout(() => {
				setSmoothZoom(true);
				wheelEndTimerRef.current = null;
			}, 150);
		}

		el.addEventListener('wheel', handleWheel, { passive: false });
		return () => {
			el.removeEventListener('wheel', handleWheel);
			if (wheelEndTimerRef.current !== null) {
				window.clearTimeout(wheelEndTimerRef.current);
				wheelEndTimerRef.current = null;
			}
		};
	}, []);

	/* ------------------------------------------------------------------ *
	 * Pan (drag to move when zoomed in)                                   *
	 * ------------------------------------------------------------------ *
	 *
	 * Only enabled when the image is zoomed past 1 — at fit or below, the
	 * image is already centered and any pan would just push it off-screen
	 * for no reason. So we automatically snap pan back to (0,0) whenever
	 * zoom returns to ≤1 (via fit, zoom-out buttons, or wheel-out).
	 *
	 * Mouse pipeline:
	 *   1. mousedown on <main>     → record start (cursor + current pan)
	 *   2. mousemove on window     → set pan = start.pan + (cursor delta)
	 *   3. mouseup on window       → end drag
	 *
	 * mousemove/up are on window (not main) so the drag continues if the
	 * cursor slips outside the canvas during the gesture — same pattern
	 * the compare slider uses.
	 *
	 * dragStartRef holds the snapshot so we don't have to thread pan
	 * through the mousemove handler's closure on every render.
	 */

	const dragStartRef = useRef<{
		cursorX: number;
		cursorY: number;
		panX: number;
		panY: number;
	} | null>(null);

	// Snap pan home whenever zoom drops to fit-or-below — there's no
	// hidden area to reveal at that scale, so any lingering pan would
	// just shift the centered image asymmetrically.
	useEffect(() => {
		if (zoom <= 1) setPan({ x: 0, y: 0 });
	}, [zoom]);

	const canPan = zoom > 1 && !!original && !compareActive;

	const handleCanvasMouseDown = useCallback(
		(e: React.MouseEvent<HTMLElement>) => {
			if (!canPan) return;
			if (e.button !== 0) return; // primary button only
			e.preventDefault(); // suppress native text-selection drag
			dragStartRef.current = {
				cursorX: e.clientX,
				cursorY: e.clientY,
				panX: pan.x,
				panY: pan.y,
			};
			setIsPanning(true);
		},
		[canPan, pan.x, pan.y],
	);

	useEffect(() => {
		if (!isPanning) return;

		function onMouseMove(e: MouseEvent) {
			const start = dragStartRef.current;
			if (!start) return;
			setPan({
				x: start.panX + (e.clientX - start.cursorX),
				y: start.panY + (e.clientY - start.cursorY),
			});
		}

		function onMouseUp() {
			setIsPanning(false);
			dragStartRef.current = null;
		}

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
		return () => {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};
	}, [isPanning]);

	/* ------------------------------------------------------------------ *
	 * Derived view state                                                  *
	 * ------------------------------------------------------------------ */

	const hasSteps = steps.length > 0;
	// A single linear pipeline, so any in-flight job means "busy".
	const isProcessing = processing !== null;
	const canCompare = hasSteps && !isProcessing;
	const canDownload = hasSteps;
	// Undo/redo are locked during a run so a late result can't append onto a
	// chain the user just stepped through.
	const canUndo = hasSteps && !isProcessing;
	const canRedo = redoSteps.length > 0 && !isProcessing;

	// Transparency checkerboard once the chain includes a background removal —
	// the alpha carries through any later steps.
	const tipHasTransparency = steps.some((s) => s.tool === 'background');

	// Sidebar dot: which tools appear anywhere in the current remix chain.
	const results: Record<Tool, boolean> = {
		background: tipHasTransparency,
		upscale: steps.some((s) => s.tool === 'upscale'),
		expand: steps.some((s) => s.tool === 'expand'),
	};

	// "After: WxH" label on the compare slider = the tip's dimensions.
	const afterWidth = tip?.width ?? 0;
	const afterHeight = tip?.height ?? 0;

	// Compare shows the effect of the LAST step: its input (the tip *before*
	// that step) vs its output (the current tip) — not the whole chain. With
	// only one step applied, that input is the original upload.
	const compareBefore = steps.length >= 2 ? steps[steps.length - 2].image : original;
	// The "before" carries transparency if a background removal happened at or
	// before the step that produced it (i.e. anywhere but the final step).
	const compareBeforeTransparent = steps
		.slice(0, steps.length - 1)
		.some((s) => s.tool === 'background');
	// Only checker the "before" when it fills the frame (same aspect as the
	// result); a letterboxed before would otherwise paint checker outside the
	// image. The "after" always fills the frame, so its checker is always safe.
	const compareSameAspect =
		!!compareBefore &&
		!!tip &&
		Math.abs(compareBefore.width / compareBefore.height - tip.width / tip.height) < 0.01;

	return (
		<div
			className={clsx(
				// Mobile: flex-column stack so header / sidebar / canvas /
				// panel sit on real pixels instead of overlapping. Uses
				// 100dvh so iOS Safari's collapsing URL bar doesn't push
				// content out of view. Desktop: block + relative restores
				// the absolute-overlay layout where the canvas fills the
				// viewport edge-to-edge and the side cards float on top.
				'flex h-[100dvh] w-screen flex-col overflow-hidden bg-[var(--color-canvas)]',
				'md:relative md:block md:h-screen',
			)}
		>
			{/* Header — in-flow on mobile, absolute on desktop (z-20). */}
			<Header
				hasImage={!!original}
				canUndo={canUndo}
				canRedo={canRedo}
				compareActive={compareActive}
				compareDisabled={!canCompare}
				downloadDisabled={!canDownload}
				onReset={handleReset}
				onUndo={undo}
				onRedo={redo}
				onCompare={() => setCompareActive((c) => !c)}
				onDownload={downloadCurrent}
			/>

			{/*
			 * Sidebar wrapper.
			 *
			 * Mobile: in-flow block under the header, full width with
			 * 12px gutter so the card edge lines up with the tool panel
			 * below. Sits as a flex-row of three tabs (handled inside
			 * Sidebar via responsive classes).
			 *
			 * Desktop: absolute-floating at top-left as before.
			 * pointer-events-none on the wrapper + auto on the inner
			 * card so empty wrapper regions don't block canvas drag/wheel.
			 */}
			<div
				className={clsx(
					'z-10 flex-shrink-0 px-3 pt-1',
					'md:pointer-events-none md:absolute md:top-24 md:left-6 md:px-0 md:pt-0',
				)}
			>
				<div className="md:pointer-events-auto">
					<Sidebar
						activeTool={tool}
						results={results}
						disabled={isProcessing}
						onSelectTool={handleSelectTool}
					/>
				</div>
			</div>

			{/*
			 * Canvas viewport.
			 *
			 * Mobile: flex-1 fills the leftover vertical space between
			 * sidebar tabs and tool panel. min-h-0 is required so the
			 * flex item can actually shrink below its content size
			 * (without it, the image would push the panel off-screen).
			 *
			 * Desktop: absolute inset-0 fills the entire viewport so the
			 * side cards visually float over a full-bleed canvas.
			 *
			 * Either way: overflow-hidden clips zoomed content, ref hosts
			 * the non-passive wheel listener, and onMouseDown starts a
			 * pan-drag when canPan is true.
			 */}
			<main
				ref={mainRef}
				onMouseDown={handleCanvasMouseDown}
				className={clsx(
					'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden',
					'md:absolute md:inset-0 md:min-h-0 md:flex-initial',
					// Container-query context for the canvas: lets the
					// CompareSlider size its frame against the canvas height
					// (cqh) regardless of the auto-sized frame in between —
					// the same trick the ImageViewer uses for its own box.
					'[container-type:size]',
					// `--compare-canvas-vw` is consumed by CompareSlider
					// to size itself within the canvas. Mobile gets the
					// full 92vw since the tool panel stacks below;
					// desktop reins it back to 60vw so the slider stays
					// clear of the floating top-right tool panel.
					'[--compare-canvas-vw:92vw] md:[--compare-canvas-vw:60vw]',
					canPan && (isPanning ? 'cursor-grabbing' : 'cursor-grab'),
				)}
			>
				{!original ? (
					<DropZone onFile={handleFile} />
				) : compareActive && tip && hasSteps && !isProcessing ? (
					<CompareSlider
						before={compareBefore ?? original}
						after={tip}
						showCheckerBefore={compareBeforeTransparent && compareSameAspect}
						showCheckerAfter={tipHasTransparency}
						afterWidth={afterWidth}
						afterHeight={afterHeight}
					/>
				) : (
					<ImageViewer
						image={tip ?? original}
						tool={processing ?? tool}
						showChecker={tipHasTransparency}
						zoom={zoom}
						pan={pan}
						smoothZoom={smoothZoom && !isPanning}
						processing={isProcessing}
						processingStartedAt={isProcessing ? processingStartedAt : null}
						error={error}
					/>
				)}
			</main>

			{/*
			 * Right tool panel.
			 *
			 * Mobile: in-flow at the bottom of the column, full width
			 * with 12px gutter, anchored above the safe-area inset.
			 *
			 * Desktop: absolute-floating at top-right, conditional on
			 * `original` so the empty drop-zone state doesn't show a
			 * panel for nothing.
			 */}
			{original && (
				<div
					className={clsx(
						'z-10 flex-shrink-0 px-3 pb-3',
						'md:pointer-events-none md:absolute md:top-24 md:right-6 md:px-0 md:pb-0',
					)}
				>
					<div className="md:pointer-events-auto">
						{tool === 'background' && (
							<BackgroundPanel
								processing={isProcessing}
								processingStartedAt={isProcessing ? processingStartedAt : null}
								result={lastTool === 'background' ? tip : null}
								onRun={handleRunBackground}
							/>
						)}
						{tool === 'upscale' && tip && (
							<UpscalePanel
								image={tip}
								settings={upscaleSettings}
								processing={isProcessing}
								processingStartedAt={isProcessing ? processingStartedAt : null}
								hasResult={lastTool === 'upscale'}
								onChangeSettings={setUpscaleSettings}
								onRetry={handleRunUpscale}
							/>
						)}
						{tool === 'expand' && tip && (
							<ExpandPanel
								image={tip}
								settings={expandSettings}
								processing={isProcessing}
								processingStartedAt={isProcessing ? processingStartedAt : null}
								result={lastTool === 'expand' ? tip : null}
								onChangeSettings={setExpandSettings}
								onGenerate={handleRunExpand}
							/>
						)}
					</div>
				</div>
			)}

			{/*
			 * Zoom + about controls. Hidden on mobile (no pinch zoom
			 * support yet, and floating clusters would overlap the
			 * bottom tool panel). Desktop keeps the bottom-right pair.
			 */}
			<BottomControls
				zoom={zoom}
				hasImage={!!original}
				onZoomIn={zoomIn}
				onZoomOut={zoomOut}
				onFit={fit}
			/>
		</div>
	);
}

function messageFor(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
