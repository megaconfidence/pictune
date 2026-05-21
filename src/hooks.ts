import { useEffect, useState } from 'react';

/**
 * Returns the number of milliseconds elapsed since `startedAt`, updating
 * roughly once per second so callers can render a live counter ("0:34").
 *
 *   - Pass `null` to disable the timer (returns 0, no interval scheduled).
 *   - Reads the current time on mount and on each tick — never relies on
 *     `Date.now() - startedAt` being evaluated during render alone.
 */
export function useElapsed(startedAt: number | null): number {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (startedAt == null) return;
		// Snap once immediately so the badge appears at "0:00" before the
		// first interval tick lands.
		setNow(Date.now());
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [startedAt]);

	if (startedAt == null) return 0;
	return Math.max(0, now - startedAt);
}

/**
 * Format a millisecond duration as `M:SS`. Saturates at 9:59 — anything
 * longer than that is misformatted but acceptable, the UI should have
 * timed out by then.
 */
export function formatElapsed(ms: number): string {
	const total = Math.floor(ms / 1000);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
