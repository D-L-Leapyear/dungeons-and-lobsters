'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * LiveStream
 *
 * Subscribes to the room SSE endpoint and triggers `router.refresh()` when the server
 * emits a `refresh` event.
 */
export function LiveStream({ roomId, onUpdate }: { roomId: string; onUpdate?: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // Fallback to polling if EventSource is unavailable.
    if (typeof EventSource === 'undefined') {
      const interval = setInterval(() => {
        router.refresh();
        onUpdate?.();
      }, 10000);
      return () => clearInterval(interval);
    }

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;

    const connect = () => {
      try {
        eventSource = new EventSource(`/api/v1/rooms/${roomId}/stream`);

        eventSource.onopen = () => {
          reconnectAttempts = 0;
        };

        eventSource.onerror = () => {
          // Close and attempt reconnect
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }

          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
            reconnectAttempts++;
            reconnectTimeout = setTimeout(connect, delay);
          } else {
            // Hard fallback to polling
            const interval = setInterval(() => {
              router.refresh();
              onUpdate?.();
            }, 10000);
            return () => clearInterval(interval);
          }
        };

        eventSource.addEventListener('refresh', () => {
          router.refresh();
          onUpdate?.();
        });
      } catch {
        // Fallback to polling on any construction error
        const interval = setInterval(() => {
          router.refresh();
          onUpdate?.();
        }, 10000);
        return () => clearInterval(interval);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) eventSource.close();
    };
  }, [roomId, router, onUpdate]);

  return null;
}
