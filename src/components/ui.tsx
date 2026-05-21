import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Buttons used across the toolbar and panels. We keep a single primitive with
 * variants so spacing, focus rings, and the scale-on-press feedback are
 * consistent everywhere.
 */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon' | 'toggle';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	active?: boolean;
	leadingIcon?: ReactNode;
}

export function Button({
	variant = 'secondary',
	active = false,
	leadingIcon,
	className,
	children,
	...rest
}: ButtonProps) {
	return (
		<button
			{...rest}
			data-active={active || undefined}
			className={clsx(
				// Base: typography, focus, and tactile press feedback.
				'inline-flex items-center justify-center gap-2 font-medium select-none',
				'transition-[background-color,color,box-shadow,scale] duration-150',
				'ease-[cubic-bezier(0.2,0,0,1)]',
				'active:scale-[0.96]',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
				'disabled:opacity-50 disabled:pointer-events-none',
				variant === 'primary' && [
					'h-10 px-4 rounded-xl text-sm text-white',
					'bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]',
				],
				variant === 'secondary' && [
					'h-10 px-4 rounded-xl text-sm text-[var(--color-ink)]',
					'bg-transparent hover:bg-[var(--color-surface-hover)]',
				],
				variant === 'ghost' && [
					'h-10 px-3 rounded-xl text-sm text-[var(--color-ink-muted)]',
					'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]',
				],
				variant === 'icon' && [
					'h-10 w-10 rounded-xl text-[var(--color-ink-muted)]',
					'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]',
				],
				variant === 'toggle' && [
					'h-10 px-4 rounded-xl text-sm',
					active
						? 'bg-[var(--color-ink)] text-white hover:bg-[var(--color-ink)]'
						: 'text-[var(--color-ink)] hover:bg-[var(--color-surface-hover)]',
				],
				className,
			)}
		>
			{leadingIcon}
			{children}
		</button>
	);
}

/**
 * Thin vertical hairline used in the toolbar between button groups.
 */
export function Divider() {
	return <span aria-hidden className="mx-0.5 h-6 w-px bg-[var(--color-line)]" />;
}
