'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeSse } from '@/lib/sse';

/**
 * LiveStream
 *
 * Subscribes to the room SSE endpoint and triggers `router.refresh()` when the server
 * emits a `refresh` event.
 */
export function LiveStream({ roomId, onUpdate }: { roomId: string; onUpdate?: () => void }) {
  const router = useRouter();

  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollInterval) return;
      pollInterval = setInterval(() => {
        router.refresh();
        onUpdate?.();
      }, 10_000);
    };

    // If EventSource is unavailable (older browsers / some runtimes), just poll.
    if (typeof EventSource === 'undefined') {
      startPolling();
      return () => {
        if (pollInterval) clearInterval(pollInterval);
      };
    }

    const unsubscribe = subscribeSse({
      url: `/api/v1/rooms/${roomId}/stream`,
      events: ['refresh'],
      onEvent: () => {
        router.refresh();
        onUpdate?.();
      },
      onGiveUp: () => {
        // If SSE can't stay connected, fall back to a quiet poll.
        startPolling();
      },
      // Keep UI responsive, but avoid aggressive reconnect loops.
      maxReconnectAttempts: 10,
      baseReconnectDelayMs: 1000,
    });

    return () => {
      unsubscribe();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [roomId, router, onUpdate]);

  return null;
}
