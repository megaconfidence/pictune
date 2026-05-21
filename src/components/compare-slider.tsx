import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageState } from '../types';

interface CompareSliderProps {
	before: ImageState;
	after: ImageState;
	/** Display the checkerboard behind the "after" image (for background tool). */
	showCheckerAfter: boolean;
	/** Display dimensions of the "after" image. Used for the corner label. */
	afterWidth: number;
	afterHeight: number;
}

/**
 * Before / after slider used when "Compare" is toggled on. The "before" image
 * is the original upload; the "after" image is the Worker's processed
 * result, layered on top and clipped to the right of the divider.
 *
 * Pointer + keyboard driven: ← / → nudges by 2% (Shift = 10%). PointerCapture
 * keeps drags responsive even when the cursor leaves the element.
 */
export function CompareSlider({
	before,
	after,
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
			className="relative cursor-ew-resize overflow-hidden rounded-lg image-outline select-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--color-canvas)] focus-visible:outline-none"
			style={{
				maxWidth: `min(${before.width}px, 60vw)`,
				maxHeight: 'min(70vh, 800px)',
			}}
		>
			{/* Before (full image, base layer). */}
			<img
				src={before.url}
				alt={`${before.name} before`}
				draggable={false}
				className="block h-auto w-full select-none"
				style={{ maxHeight: 'min(70vh, 800px)' }}
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
				className="pointer-events-none absolute inset-y-0 w-px bg-white/90"
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
							'0 1px 2px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.12)',
						display: 'grid',
						placeItems: 'center',
					}}
				>
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
						<path
							d="M4.5 4L1.5 7L4.5 10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<path
							d="M9.5 4L12.5 7L9.5 10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</div>
			</div>

			{/* Corner labels with tabular nums so digits don't shift. */}
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
			className={`${className ?? ''} flex items-center gap-2 rounded-md bg-black/65 px-2.5 py-1 text-[12px] text-white backdrop-blur-sm`}
		>
			<span className="font-medium">{label}</span>
			<span className="tabular-nums text-white/75">
				{width}×{height}
			</span>
		</div>
	);
}
