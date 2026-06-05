import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageState } from '../types';

interface CompareSliderProps {
	before: ImageState;
	after: ImageState;
	/** Display the checkerboard behind the "before" image (transparent input). */
	showCheckerBefore: boolean;
	/** Display the checkerboard behind the "after" image (transparent result). */
	showCheckerAfter: boolean;
	/** Display dimensions of the "after" image. Used for the corner label. */
	afterWidth: number;
	afterHeight: number;
}

/**
 * Before / after slider used when "Compare" is toggled on. It shows the
 * effect of the most recent step: "before" is that step's input (the previous
 * tip, or the original upload if it's the first step) and "after" is the step's
 * output. The "after" is layered on top and clipped to the right of the
 * divider.
 *
 * Pointer + keyboard driven: ← / → nudges by 2% (Shift = 10%).
 * PointerCapture keeps drags responsive even when the cursor leaves the
 * element.
 */
export function CompareSlider({
	before,
	after,
	showCheckerBefore,
	showCheckerAfter,
	afterWidth,
	afterHeight,
}: CompareSliderProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState(50);
	const draggingRef = useRef(false);

	const updateFromClientX = useCallback((clientX: number) => {
		const el = containerRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const pct = ((clientX - rect.left) / rect.width) * 100;
		setPosition(Math.min(100, Math.max(0, pct)));
	}, []);

	const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		draggingRef.current = true;
		e.currentTarget.setPointerCapture(e.pointerId);
		updateFromClientX(e.clientX);
	};
	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		updateFromClientX(e.clientX);
	};
	const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
		draggingRef.current = false;
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {
			/* releasing when not captured throws on some browsers — ignore */
		}
	};

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (document.activeElement !== containerRef.current) return;
			if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
			const step = e.shiftKey ? 10 : 2;
			e.preventDefault();
			setPosition((p) =>
				Math.min(100, Math.max(0, p + (e.key === 'ArrowRight' ? step : -step))),
			);
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	return (
		<div
			ref={containerRef}
			role="slider"
			aria-label="Before and after comparison"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(position)}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			className="image-outline relative cursor-ew-resize overflow-hidden rounded-[12px] select-none animate-rise focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--color-canvas)] focus-visible:outline-none"
			style={{
				// The frame takes the RESULT's (after) aspect ratio and both
				// images are object-contained inside it. That's what keeps the
				// comparison sane when the two images are differently shaped —
				// e.g. a landscape original vs a 9:16 expand. The result fills
				// the frame; the original is centred within it, which lines the
				// two up (expand embeds the original centred). When the shapes
				// match, both simply fill the frame, exactly as before.
				aspectRatio: `${after.width} / ${after.height}`,
				// Largest box of that aspect ratio that fits the canvas. Capped
				// by the result's natural width, the responsive width budget
				// (60vw desktop / 92vw mobile), and — via the cqh term — the
				// height budget, so the box never overflows vertically. cqh is
				// the canvas height (main is the container-query context), which
				// resolves correctly on both desktop and the shorter mobile
				// canvas. aspect-ratio then derives the height from this width.
				width: `min(${after.width}px, var(--compare-canvas-vw, 92vw), calc(min(100cqh, 72vh, 820px) * ${after.width} / ${after.height}))`,
			}}
		>
			{/* Before — base layer. Object-contained so a differently shaped
			    input is letterboxed (and, for expand, aligned) inside the
			    result-shaped frame instead of stretching it. A checker sits
			    behind it when the input itself is transparent. */}
			{showCheckerBefore && <div className="bg-checker absolute inset-0" aria-hidden />}
			<img
				src={before.url}
				alt={`${before.name} before`}
				draggable={false}
				className="absolute inset-0 block h-full w-full select-none object-contain"
			/>

			{/* After (clipped to the portion right of the divider). */}
			<div
				className="absolute inset-0 overflow-hidden"
				style={{ clipPath: `inset(0 0 0 ${position}%)` }}
				aria-hidden
			>
				<div
					className={
						showCheckerAfter ? 'bg-checker absolute inset-0' : 'absolute inset-0'
					}
				>
					<img
						src={after.url}
						alt=""
						draggable={false}
						className="block h-full w-full select-none object-contain"
					/>
				</div>
			</div>

			{/* Divider line + handle. */}
			<div
				className="pointer-events-none absolute inset-y-0 w-px bg-white/95"
				style={{ left: `${position}%`, boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.08)' }}
				aria-hidden
			>
				<div
					className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
					style={{
						width: 32,
						height: 32,
						borderRadius: 9999,
						background: 'white',
						boxShadow:
							'0 0 0 1px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.12)',
						display: 'grid',
						placeItems: 'center',
					}}
				>
					<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
						<path
							d="M4.5 4L1.5 7L4.5 10"
							stroke="var(--color-ink)"
							strokeWidth="1.75"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<path
							d="M9.5 4L12.5 7L9.5 10"
							stroke="var(--color-ink)"
							strokeWidth="1.75"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</div>
			</div>

			{/* Corner labels — ink fill, tabular dimensions. */}
			<DimensionLabel
				className="absolute bottom-3 left-3"
				label="Before"
				width={before.width}
				height={before.height}
			/>
			<DimensionLabel
				className="absolute right-3 bottom-3"
				label="After"
				width={afterWidth}
				height={afterHeight}
			/>
		</div>
	);
}

/**
 * Pill label used at the corners of the slider. Ink fill at high alpha
 * with tabular nums so the digits don't shift as compare position changes.
 */
function DimensionLabel({
	className,
	label,
	width,
	height,
}: {
	className?: string;
	label: string;
	width: number;
	height: number;
}) {
	return (
		<div
			className={`${className ?? ''} flex items-center gap-2 rounded-[8px] px-2.5 py-1 text-[11.5px] text-white backdrop-blur-md`}
			style={{ backgroundColor: 'rgba(10, 10, 10, 0.82)' }}
		>
			<span className="font-medium">{label}</span>
			<span className="tabular-nums text-white/75">
				{width}×{height}
			</span>
		</div>
	);
}
