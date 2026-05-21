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
	type AspectRatioPreset,
	blobToImageState,
	type ExpandSettings,
	type ImageState,
	type Tool,
	type UpscaleSettings,
} from './types';

/**
 * Top-level container.
 *
 * State model:
 *
 *   original          — the user's upload. Kept as both an ImageState (for
 *                       display) and the raw File (so we can re-POST it to
 *                       the Worker without re-uploading).
 *   background        — cached result of /api/remove-background. null until
 *                       processed, cleared when a new image is uploaded.
 *   upscale           — cached result of /api/upscale plus the settings used,
 *                       so we know whether the cache is stale when the user
 *                       toggles 2x/4x or Fast/Quality.
 *   processing        — which tool is currently running, if any. Used to
 *                       show the loading overlay.
 *   error             — last error message, scoped to the active tool.
 *
 * Processing is triggered automatically when:
 *   - a file is uploaded (kicks off the active tool's processor)
 *   - the user switches to a tool that has no cached result for the current
 *     image
 *   - the user hits Retry in the upscale panel after changing settings
 */
export default function App() {
	const [tool, setTool] = useState<Tool>('background');
	const [original, setOriginal] = useState<ImageState | null>(null);
	const [originalFile, setOriginalFile] = useState<File | null>(null);

	const [background, setBackground] = useState<ImageState | null>(null);
	const [upscaleResult, setUpscaleResult] = useState<
		{ image: ImageState; settings: UpscaleSettings } | null
	>(null);
	const [expandResult, setExpandResult] = useState<
		{ image: ImageState; ratio: AspectRatioPreset } | null
	>(null);

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
	// Aborting on tool change / new upload prevents stale state from clobbering
	// what the user actually wants to see.
	const abortRef = useRef<AbortController | null>(null);

	// Revoke object URLs we own. The cleanup runs when an ImageState is
	// replaced or the app unmounts.
	useEffect(() => () => revoke(original), [original]);
	useEffect(() => () => revoke(background), [background]);
	useEffect(() => () => revoke(upscaleResult?.image), [upscaleResult]);
	useEffect(() => () => revoke(expandResult?.image), [expandResult]);

	/* ------------------------------------------------------------------ *
	 * File handling                                                       *
	 * ------------------------------------------------------------------ */

	const handleFile = useCallback((file: File) => {
		const url = URL.createObjectURL(file);
		const probe = new Image();
		probe.onload = () => {
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
		setOriginal(null);
		setOriginalFile(null);
		setBackground(null);
		setUpscaleResult(null);
		setExpandResult(null);
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

	const handleClearTool = useCallback(() => {
		setTool('background');
	}, []);

	/* ------------------------------------------------------------------ *
	 * Replicate calls                                                     *
	 * ------------------------------------------------------------------ */

	const runBackground = useCallback(
		async (file: File) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setProcessing('background');
			setProcessingStartedAt(Date.now());
			setError(null);
			try {
				const blob = await api.removeBackground(file, { signal: controller.signal });
				const image = await blobToImageState(blob, 'background-removed.png');
				setBackground(image);
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
		[],
	);

	const runUpscale = useCallback(
		async (file: File, settings: UpscaleSettings) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setProcessing('upscale');
			setProcessingStartedAt(Date.now());
			setError(null);
			try {
				const blob = await api.upscale(file, settings, { signal: controller.signal });
				const image = await blobToImageState(blob, 'upscaled.png');
				setUpscaleResult({ image, settings });
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
		[],
	);

	const runExpand = useCallback(
		async (file: File, ratio: AspectRatioPreset) => {
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;
			setProcessing('expand');
			setProcessingStartedAt(Date.now());
			setError(null);
			try {
				const blob = await api.expand(file, ratio, { signal: controller.signal });
				const image = await blobToImageState(blob, `expanded-${ratio.replace(':', 'x')}.png`);
				setExpandResult({ image, ratio });
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
		[],
	);

	// None of the three tools auto-run any more — every Replicate call costs
	// money, so we wait for the user to opt in via the panel's Run button.
	// The panels handle the per-tool variants (settings, dimensions, etc.).

	const handleRunBackground = useCallback(() => {
		if (!originalFile) return;
		setBackground(null);
		void runBackground(originalFile);
	}, [originalFile, runBackground]);

	const handleRetryUpscale = useCallback(() => {
		if (!originalFile) return;
		setUpscaleResult(null);
		void runUpscale(originalFile, upscaleSettings);
	}, [originalFile, upscaleSettings, runUpscale]);

	const handleGenerateExpand = useCallback(
		(effectiveRatio: AspectRatioPreset) => {
			if (!originalFile) return;
			setExpandResult(null);
			void runExpand(originalFile, effectiveRatio);
		},
		[originalFile, runExpand],
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

	// Dimensions for the "After: WxH" label on the compare slider.
	const afterWidth = result?.width ?? original?.width ?? 0;
	const afterHeight = result?.height ?? original?.height ?? 0;

	return (
		<div className="relative flex h-screen w-screen overflow-hidden bg-[var(--color-canvas)]">
			<Header
				hasImage={!!original}
				canUndo={false}
				canRedo={false}
				compareActive={compareActive}
				compareDisabled={!canCompare}
				downloadDisabled={!canDownload}
				onReset={handleReset}
				onUndo={() => {}}
				onRedo={() => {}}
				onCompare={() => setCompareActive((c) => !c)}
				onDownload={downloadCurrent}
			/>

			<div className="flex w-full items-stretch pt-24 pb-24">
				<div className="flex w-full items-start gap-6 px-6">
					<Sidebar
						activeTool={tool}
						onSelectTool={handleSelectTool}
						onClearTool={handleClearTool}
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

function revoke(image: ImageState | null | undefined) {
	if (image?.url) URL.revokeObjectURL(image.url);
}

function messageFor(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
