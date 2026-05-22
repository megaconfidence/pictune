import clsx from 'clsx';
import { ArrowUpFromLine } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';

interface DropZoneProps {
	onFile: (file: File) => void;
}

/**
 * Empty-state shown before any image is uploaded.
 *
 * Minimal by design: a single inviting target, a small teal upload
 * glyph, and a primary line of copy. No tool teaser, no animated
 * background, no serif moment. The point of the empty state is "drop
 * here" — anything more pulls attention away. (The free / no sign-in
 * / unlimited reassurance lives in the sidebar footer so it's visible
 * after upload too.)
 *
 * Implementation notes:
 *   - The whole card is the drop target; file selection routes through
 *     a hidden <input>. Click anywhere on the card or on the "browse"
 *     link to open the file picker.
 *   - The drag counter pattern (`dragCounter.current`) prevents flicker
 *     when the cursor crosses child elements during a hover.
 *   - The teal icon tile is the same quiet accent as the wordmark dot
 *     and the active sidebar item — one color family throughout.
 *   - On drag-over the dashed border switches to a solid teal hairline
 *     and the icon tile inverts to solid teal. Two simultaneous
 *     affordances so the user can't miss the drop target.
 */
export function DropZone({ onFile }: DropZoneProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const dragCounter = useRef(0);
	const [dragOver, setDragOver] = useState(false);

	function handleDragEnter(e: DragEvent<HTMLDivElement>) {
		e.preventDefault();
		dragCounter.current += 1;
		if (e.dataTransfer.types.includes('Files')) setDragOver(true);
	}

	function handleDragLeave(e: DragEvent<HTMLDivElement>) {
		e.preventDefault();
		dragCounter.current -= 1;
		if (dragCounter.current <= 0) {
			dragCounter.current = 0;
			setDragOver(false);
		}
	}

	function handleDragOver(e: DragEvent<HTMLDivElement>) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}

	function handleDrop(e: DragEvent<HTMLDivElement>) {
		e.preventDefault();
		dragCounter.current = 0;
		setDragOver(false);
		const file = e.dataTransfer.files?.[0];
		if (file && file.type.startsWith('image/')) onFile(file);
	}

	return (
		<div
			onClick={() => inputRef.current?.click()}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			role="button"
			tabIndex={0}
			aria-label="Drop an image or click to choose"
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					inputRef.current?.click();
				}
			}}
			className={clsx(
				'group relative grid w-[min(520px,100%)] cursor-pointer place-items-center px-10 py-16 rounded-[20px]',
				'transition-[background-color,border-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)] focus-visible:ring-offset-4 focus-visible:ring-offset-[var(--color-canvas)]',
				'animate-rise',
				dragOver
					? 'border border-[var(--color-brand)] bg-[var(--color-brand-soft)]/40'
					: 'border border-dashed border-[var(--color-line-strong)]/80 hover:border-[var(--color-ink-subtle)] hover:bg-[var(--color-surface-soft)]/40',
			)}
		>
			{/*
			 * Upload icon — teal-soft by default so the brand accent is
			 * present from the first frame, inverts to solid teal on
			 * drag/hover for a clear "yes, drop here" cue.
			 */}
			<div
				className={clsx(
					'grid h-11 w-11 place-items-center rounded-full',
					'transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
					dragOver
						? 'bg-[var(--color-brand)] text-white'
						: 'bg-[var(--color-brand-soft)] text-[var(--color-brand)] group-hover:bg-[var(--color-brand)] group-hover:text-white',
				)}
			>
				<ArrowUpFromLine className="h-[18px] w-[18px]" strokeWidth={2} />
			</div>

			{/* Headline + sub copy */}
			<p className="mt-5 text-[15px] font-medium text-[var(--color-ink)]">
				{dragOver ? 'Drop to upload' : 'Drop an image'}
			</p>
			<p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
				or{' '}
				<span className="font-medium text-[var(--color-brand)] underline decoration-[var(--color-brand)]/30 underline-offset-[3px] transition-colors group-hover:decoration-[var(--color-brand)]">
					browse
				</span>{' '}
				from your computer
			</p>

			<input
				ref={inputRef}
				name="image-upload"
				type="file"
				accept="image/*"
				className="sr-only"
				aria-label="Upload image"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) onFile(file);
					// Reset so picking the same file again still triggers onChange.
					e.target.value = '';
				}}
			/>
		</div>
	);
}
