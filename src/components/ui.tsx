import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Buttons used across the toolbar and panels. A single primitive with a
 * small set of variants. One primary color (teal) means we never have to
 * answer "which button looks more important?" — heavier weight + filled
 * background = primary, everything else is quiet.
 *
 *   - primary   → teal fill, white text. Used wherever an action commits
 *                 work: panel CTAs, header Download. Same color = same
 *                 weight.
 *   - secondary → transparent on hover-gray. The neutral default.
 *   - icon      → square slot for an icon. Hover-gray on press.
 *   - toggle    → on/off state. Active = ink fill.
 *
 * Scale-on-press (0.96) gives a subtle tactile beat. Transitions name
 * exact properties (never `all`) so nothing animates by accident.
 */
type ButtonVariant = 'primary' | 'secondary' | 'icon' | 'toggle';

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
				'inline-flex items-center justify-center gap-2 font-medium select-none',
				'transition-[background-color,color,box-shadow,scale,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]',
				'active:scale-[0.96]',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
				'disabled:opacity-40 disabled:pointer-events-none',
				variant === 'primary' && [
					'h-9 px-3.5 rounded-[10px] text-[13px] font-medium text-white',
					'bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)]',
				],
				variant === 'secondary' && [
					'h-9 px-3.5 rounded-[10px] text-[13px] text-[var(--color-ink)]',
					'hover:bg-[var(--color-surface-soft)]',
				],
				variant === 'icon' && [
					'h-9 w-9 rounded-[10px] text-[var(--color-ink-muted)]',
					'hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]',
				],
				variant === 'toggle' && [
					'h-9 px-3.5 rounded-[10px] text-[13px] font-medium',
					active
						? 'bg-[var(--color-ink)] text-white'
						: 'text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]',
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
 * Hairline divider between button clusters in the toolbar.
 */
export function Divider() {
	return <span aria-hidden className="mx-1 h-5 w-px bg-[var(--color-line-strong)]/70" />;
}

/**
 * Inline loading spinner — used inside primary buttons during processing.
 * Sized for 14px text. Stroke follows `currentColor` so it works on both
 * ink and teal backgrounds.
 */
export function InlineSpinner({ className }: { className?: string }) {
	return (
		<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className={className}>
			<circle
				cx="7"
				cy="7"
				r="5.5"
				fill="none"
				stroke="currentColor"
				strokeOpacity="0.28"
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
