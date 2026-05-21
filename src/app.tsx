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
import {
	type Action,
	type AspectRatioPreset,
	type BackgroundState,
	blobToImageState,
	type ExpandResultState,
	type ExpandSettings,
	type ImageState,
	type Tool,
	type UpscaleSettings,
	type UpscaleState,
} from './types';

/**
 * Top-level container.
 *
 * State model:
 *
 *   original              — the user's upload. Kept as both an ImageState (for
 *                           display) and the raw File (so we can re-POST it
 *                           to the Worker without re-uploading).
 *   background /          — cached result of each tool. Independent: every
 *   upscaleResult /         tool processes the *original*, not a chain of
 *   expandResult            priors, so we keep three parallel slots and
 *                           switch the viewer based on the active tool.
 *   undoStack / redoStack — chronological history of result mutations. Each
 *                           entry is an Action that records before/after
 *                           snapshots for one tool. Run pushes an action;
 *                           the per-tool X pushes an action; Undo in the
 *                           header pops the latest and applies its `before`;
 *                           Redo re-applies the last popped action's `after`.
 *                           Neither button re-runs the API — we just restore
 *                           cached image bytes.
 *   processing            — which tool is currently running, if any. Used
 *                           to show the loading overlay.
 *   error                 — last error message, scoped to the active tool.
 *
 * Object-URL lifecycle: any URL we create (either from blobToImageState for
 * a result, or directly from the uploaded File) is appended to a Set we
 * revoke en masse on Reset / new upload / unmount. We can't auto-revoke on
 * state change because undo and redo restore cached results — revoking the
 * URL mid-history would leave us with a dead reference. The Set is bounded
 * in practice (one upload + at most a few generated images per session).
 */
export default function App() {
	const [tool, setTool] = useState<Tool>('background');
	const [original, setOriginal] = useState<ImageState | null>(null);
	const [originalFile, setOriginalFile] = useState<File | null>(null);

	const [background, setBackground] = useState<BackgroundState>(null);
	const [upscaleResult, setUpscaleResult] = useState<UpscaleState>(null);
	const [expandResult, setExpandResult] = useState<ExpandResultState>(null);

	const [undoStack, setUndoStack] = useState<Action[]>([]);
	const [redoStack, setRedoStack] = useState<Action[]>([]);

	const [processing, setProcessing] = useState<Tool | null>(null);
	const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [compareActive, setCompareActive] = useState(false);
	const [zoom, setZoom] = useState(1);
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
	 * Undo / redo                                                         *
	 * ------------------------------------------------------------------ */

	/**
	 * Apply one side of an action to the corresponding tool's state. The
	 * action's `tool` discriminator narrows before/after to the right shape,
	 * so the setter call is type-safe without runtime checks on the payload.
	 */
	const applyAction = useCallback((action: Action, side: 'before' | 'after') => {
		if (action.tool === 'background') {
			setBackground(action[side]);
		} else if (action.tool === 'upscale') {
			setUpscaleResult(action[side]);
		} else if (action.tool === 'expand') {
			setExpandResult(action[side]);
		}
	}, []);

	/**
	 * Push a new action onto the undo stack and clear the redo stack — the
	 * canonical "linear history loses its forward branch on new action"
	 * behaviour everyone expects from Cmd+Z.
	 */
	const recordAction = useCallback((action: Action) => {
		setUndoStack((s) => [...s, action]);
		setRedoStack([]);
	}, []);

	// Both stacks are read at call time (not via setState updaters) so we can
	// keep all side-effecting calls (setTool, applyAction, etc.) OUTSIDE the
	// updaters. Nesting a setState inside another setState's updater triggers
	// double execution under React StrictMode in dev, which doubles the
	// updates queued by the inner setter — silently corrupting the stack.
	const undo = useCallback(() => {
		if (undoStack.length === 0) return;
		const action = undoStack[undoStack.length - 1];
		applyAction(action, 'before');
		// Switch active tool so the canvas reflects the change. Without this,
		// undoing an inactive tool's action would look like nothing happened.
		setTool(action.tool);
		// Compare slider compares "before" against "after" — neither is
		// guaranteed to still exist after a history hop, so close it.
		setCompareActive(false);
		setError(null);
		setUndoStack(undoStack.slice(0, -1));
		setRedoStack([...redoStack, action]);
	}, [undoStack, redoStack, applyAction]);

	const redo = useCallback(() => {
		if (redoStack.length === 0) return;
		const action = redoStack[redoStack.length - 1];
		applyAction(action, 'after');
		setTool(action.tool);
		setCompareActive(false);
		setError(null);
		setRedoStack(redoStack.slice(0, -1));
		setUndoStack([...undoStack, action]);
	}, [undoStack, redoStack, applyAction]);

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
			setOriginal({
				url,
				name: file.name,
				width: probe.naturalWidth,
				height: probe.naturalHeight,
			});
			setOriginalFile(file);
			// Reset per-image derived state.
			setBackground(null);
			setUpscaleResult(null);
			setExpandResult(null);
			setUndoStack([]);
			setRedoStack([]);
			setExpandSettings({
				choice: 'custom',
				width: probe.naturalWidth,
				height: probe.naturalHeight,
				linked: true,
			});
			setCompareActive(false);
			setZoom(1);
			setError(null);
		};
		probe.onerror = () => URL.revokeObjectURL(url);
		probe.src = url;
	}, []);

	const handleReset = useCallback(() => {
		abortRef.current?.abort();
		for (const url of urlsRef.current) URL.revokeObjectURL(url);
		urlsRef.current.clear();
		setOriginal(null);
		setOriginalFile(null);
		setBackground(null);
		setUpscaleResult(null);
		setExpandResult(null);
		setUndoStack([]);
		setRedoStack([]);
		setProcessing(null);
		setProcessingStartedAt(null);
		setError(null);
		setCompareActive(false);
		setZoom(1);
	}, []);

	const handleSelectTool = useCallback((next: Tool) => {
		setTool(next);
		setCompareActive(false);
		setError(null);
	}, []);

	/**
	 * Per-tool X button. Clears that tool's result via an action so the
	 * change lands in history (and can be undone). If the user happens to
	 * be running this same tool right now, we also abort the in-flight job
	 * — there's no point letting it overwrite null with a result the user
	 * just declared they didn't want.
	 */
	const handleClearResult = useCallback(
		(target: Tool) => {
			if (processing === target) {
				abortRef.current?.abort();
				setProcessing(null);
				setProcessingStartedAt(null);
			}
			if (target === 'background' && background) {
				recordAction({ tool: 'background', before: background, after: null });
				setBackground(null);
			} else if (target === 'upscale' && upscaleResult) {
				recordAction({ tool: 'upscale', before: upscaleResult, after: null });
				setUpscaleResult(null);
			} else if (target === 'expand' && expandResult) {
				recordAction({ tool: 'expand', before: expandResult, after: null });
				setExpandResult(null);
			}
			// If we just wiped what the canvas was showing, drop compare mode.
			if (target === tool) {
				setCompareActive(false);
			}
		},
		[processing, background, upscaleResult, expandResult, recordAction, tool],
	);

	/* ------------------------------------------------------------------ *
	 * Replicate calls                                                     *
	 * ------------------------------------------------------------------ */

	// Each run* receives `prior` — that tool's result at the moment the user
	// clicked Run. On success we record {before: prior, after: new} so undo
	// restores prior. On abort we bail before recording, keeping history
	// clean.
	//
	// We deliberately do NOT clear the prior result before starting. The
	// ImageViewer dims it and overlays the spinner instead — a "your
	// previous result is being replaced" affordance, rather than a flash
	// back to the original.

	const runBackground = useCallback(
		async (file: File, prior: BackgroundState) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setProcessing('background');
			setProcessingStartedAt(Date.now());
			setError(null);
			try {
				const blob = await api.removeBackground(file, { signal: controller.signal });
				if (controller.signal.aborted) return;
				const image = await blobToImageState(blob, 'background-removed.png');
				if (controller.signal.aborted) return;
				trackUrl(image.url);
				setBackground(image);
				recordAction({ tool: 'background', before: prior, after: image });
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
		[recordAction, trackUrl],
	);

	const runUpscale = useCallback(
		async (file: File, settings: UpscaleSettings, prior: UpscaleState) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setProcessing('upscale');
			setProcessingStartedAt(Date.now());
			setError(null);
			try {
				const blob = await api.upscale(file, settings, { signal: controller.signal });
				if (controller.signal.aborted) return;
				const image = await blobToImageState(blob, 'upscaled.png');
				if (controller.signal.aborted) return;
				trackUrl(image.url);
				const next = { image, settings };
				setUpscaleResult(next);
				recordAction({ tool: 'upscale', before: prior, after: next });
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
		[recordAction, trackUrl],
	);

	const runExpand = useCallback(
		async (file: File, ratio: AspectRatioPreset, prior: ExpandResultState) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setProcessing('expand');
			setProcessingStartedAt(Date.now());
			setError(null);
			try {
				const blob = await api.expand(file, ratio, { signal: controller.signal });
				if (controller.signal.aborted) return;
				const image = await blobToImageState(blob, `expanded-${ratio.replace(':', 'x')}.png`);
				if (controller.signal.aborted) return;
				trackUrl(image.url);
				const next = { image, ratio };
				setExpandResult(next);
				recordAction({ tool: 'expand', before: prior, after: next });
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
		[recordAction, trackUrl],
	);

	const handleRunBackground = useCallback(() => {
		if (!originalFile) return;
		void runBackground(originalFile, background);
	}, [originalFile, background, runBackground]);

	const handleRetryUpscale = useCallback(() => {
		if (!originalFile) return;
		void runUpscale(originalFile, upscaleSettings, upscaleResult);
	}, [originalFile, upscaleSettings, upscaleResult, runUpscale]);

	const handleGenerateExpand = useCallback(
		(effectiveRatio: AspectRatioPreset) => {
			if (!originalFile) return;
			void runExpand(originalFile, effectiveRatio, expandResult);
		},
		[originalFile, expandResult, runExpand],
	);

	/* ------------------------------------------------------------------ *
	 * Download                                                            *
	 * ------------------------------------------------------------------ */

	const downloadCurrent = useCallback(() => {
		const result = currentResult(
			tool,
			background,
			upscaleResult?.image,
			expandResult?.image,
		);
		if (!result) return;
		const a = document.createElement('a');
		a.href = result.url;
		a.download = result.name;
		document.body.appendChild(a);
		a.click();
		a.remove();
	}, [tool, background, upscaleResult, expandResult]);

	/* ------------------------------------------------------------------ *
	 * Zoom                                                                *
	 * ------------------------------------------------------------------ */

	const zoomIn = useCallback(() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2))), []);
	const zoomOut = useCallback(() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2))), []);
	const fit = useCallback(() => setZoom(1), []);

	/* ------------------------------------------------------------------ *
	 * Derived view state                                                  *
	 * ------------------------------------------------------------------ */

	const result = currentResult(
		tool,
		background,
		upscaleResult?.image,
		expandResult?.image,
	);
	const isProcessing = processing === tool;
	const canCompare = !!result && !!original && !isProcessing;
	const canDownload = !!result;
	const canUndo = undoStack.length > 0;
	const canRedo = redoStack.length > 0;

	// Per-tool "has a result" flags, used by the sidebar to decide whether
	// to show the X (undo just this tool's result) on each row.
	const results: Record<Tool, boolean> = {
		background: background !== null,
		upscale: upscaleResult !== null,
		expand: expandResult !== null,
	};

	// Dimensions for the "After: WxH" label on the compare slider.
	const afterWidth = result?.width ?? original?.width ?? 0;
	const afterHeight = result?.height ?? original?.height ?? 0;

	return (
		<div className="relative flex h-screen w-screen overflow-hidden bg-[var(--color-canvas)]">
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

			<div className="flex w-full items-stretch pt-24 pb-24">
				<div className="flex w-full items-start gap-6 px-6">
					<Sidebar
						activeTool={tool}
						results={results}
						onSelectTool={handleSelectTool}
						onClearResult={handleClearResult}
					/>

					<main className="flex min-w-0 flex-1 items-center justify-center">
						{!original ? (
							<DropZone onFile={handleFile} />
						) : compareActive && result ? (
							<CompareSlider
								before={original}
								after={result}
								showCheckerAfter={tool === 'background'}
								afterWidth={afterWidth}
								afterHeight={afterHeight}
							/>
						) : (
							<ImageViewer
								image={result ?? original}
								tool={tool}
								zoom={zoom}
								processing={isProcessing}
								processingStartedAt={isProcessing ? processingStartedAt : null}
								error={error}
							/>
						)}
					</main>

					{original && tool === 'background' && (
						<BackgroundPanel
							processing={isProcessing}
							processingStartedAt={isProcessing ? processingStartedAt : null}
							result={background}
							onRun={handleRunBackground}
						/>
					)}

					{original && tool === 'upscale' && (
						<UpscalePanel
							image={original}
							settings={upscaleSettings}
							processing={isProcessing}
							processingStartedAt={isProcessing ? processingStartedAt : null}
							hasResult={!!upscaleResult}
							onChangeSettings={setUpscaleSettings}
							onRetry={handleRetryUpscale}
						/>
					)}

					{original && tool === 'expand' && (
						<ExpandPanel
							image={original}
							settings={expandSettings}
							processing={isProcessing}
							processingStartedAt={isProcessing ? processingStartedAt : null}
							result={expandResult?.image ?? null}
							onChangeSettings={setExpandSettings}
							onGenerate={handleGenerateExpand}
						/>
					)}
				</div>
			</div>

			<BottomControls
				zoom={zoom}
				hasImage={!!original}
				onZoomIn={zoomIn}
				onZoomOut={zoomOut}
				onFit={fit}
				onHelp={() => {}}
			/>
		</div>
	);
}

/** Pick the result image to display / download for the current tool. */
function currentResult(
	tool: Tool,
	background: ImageState | null,
	upscale: ImageState | undefined,
	expand: ImageState | undefined,
): ImageState | null {
	if (tool === 'background') return background;
	if (tool === 'upscale') return upscale ?? null;
	if (tool === 'expand') return expand ?? null;
	return null;
}

function messageFor(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
