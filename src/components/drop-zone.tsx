import clsx from 'clsx';
import { useRef, useState, type DragEvent } from 'react';

interface DropZoneProps {
	onFile: (file: File) => void;
}

/**
 * Empty-state drop target shown when no image has been uploaded. Matches the
 * dashed rounded rectangle with the "Drop or choose images" copy.
 *
 * Implementation notes:
 *   - The whole card is a drop target, but file selection goes through a
 *     hidden <input type="file">. The "choose" text and a click anywhere on
 *     the card both trigger it.
 *   - We track `dragOver` so the border + background can highlight while
 *     a file is hovering. The drag counter pattern avoids flicker when the
 *     user drags over child elements.
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
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
			}}
			className={clsx(
				'group relative grid place-items-center',
				'h-[360px] w-[480px] max-w-full cursor-pointer rounded-2xl',
				'transition-[background-color,border-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
				dragOver
					? 'border-2 border-dashed border-[var(--color-brand)] bg-[color:rgb(37_99_235_/_0.05)]'
					: 'border-2 border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-active)]/40 hover:bg-[var(--color-surface-active)]/60',
			)}
		>
			<p className="text-[15px] text-[var(--color-ink-muted)]">
				Drop or{' '}
				<span className="underline decoration-from-font underline-offset-[3px] text-[var(--color-ink)] group-hover:text-[var(--color-brand)]">
					choose
				</span>{' '}
				images
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
