'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type StreamEvent = {
  id?: string;
  kind?: string;
  content?: string;
  created_at?: string;
  bot_name?: string;
};

type TurnState = {
  room_id?: string;
  current_bot_id?: string | null;
  turn_index?: number;
  updated_at?: string;
};

type Character = {
  bot_id: string;
  name: string;
  class: string;
  level: number;
  max_hp: number;
  current_hp: number;
  is_dead: boolean;
  updated_at?: string;
};

type Summary = {
  room_id?: string;
  party_level?: number;
  party_current_hp?: number;
  party_max_hp?: number;
  updated_at?: string;
};

/**
 * LiveStream component using Server-Sent Events (SSE) for real-time updates.
 * Falls back to polling if SSE is not supported.
 */
export function LiveStream({ roomId, onUpdate }: { roomId: string; onUpdate?: () => void }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if EventSource is supported
    if (typeof EventSource === 'undefined') {
      // Fallback to polling
      console.warn('[LiveStream] EventSource not supported, falling back to polling');
      const interval = setInterval(() => {
        router.refresh();
        onUpdate?.();
      }, 10000); // Poll every 10 seconds
      return () => clearInterval(interval);
    }

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;

    const connect = () => {
      try {
        const url = `/api/v1/rooms/${roomId}/stream`;
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
          setConnected(true);
          setError(null);
          reconnectAttempts = 0;
        };

        eventSource.onerror = (e) => {
          setConnected(false);
          console.error('[LiveStream] SSE error:', e);

          // Close and attempt reconnect
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }

          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
            reconnectAttempts++;
            setError(`Reconnecting in ${Math.round(delay / 1000)}s...`);
            reconnectTimeout = setTimeout(connect, delay);
          } else {
            setError('Connection failed. Falling back to polling.');
            // Fallback to polling
            const interval = setInterval(() => {
              router.refresh();
              onUpdate?.();
            }, 10000);
            return () => clearInterval(interval);
          }
        };

        // Handle ping events (keep-alive)
        eventSource.addEventListener('ping', () => {
          // Acknowledge ping
        });

        // Handle new events
        eventSource.addEventListener('event', (e: MessageEvent) => {
          try {
            const event = JSON.parse(e.data) as StreamEvent;
            // Trigger a refresh to get the latest state
            router.refresh();
            onUpdate?.();
          } catch (err) {
            console.error('[LiveStream] Error parsing event:', err);
          }
        });

        // Handle turn updates
        eventSource.addEventListener('turn', (e: MessageEvent) => {
          try {
            const turn = JSON.parse(e.data) as TurnState | null;
            if (turn) {
              router.refresh();
              onUpdate?.();
            }
          } catch (err) {
            console.error('[LiveStream] Error parsing turn:', err);
          }
        });

        // Handle character updates
        eventSource.addEventListener('characters', (e: MessageEvent) => {
          try {
            const characters = JSON.parse(e.data) as Character[];
            if (characters && characters.length > 0) {
              router.refresh();
              onUpdate?.();
            }
          } catch (err) {
            console.error('[LiveStream] Error parsing characters:', err);
          }
        });

        // Handle summary updates
        eventSource.addEventListener('summary', (e: MessageEvent) => {
          try {
            const summary = JSON.parse(e.data) as Summary | null;
            if (summary) {
              router.refresh();
              onUpdate?.();
            }
          } catch (err) {
            console.error('[LiveStream] Error parsing summary:', err);
          }
        });

        // Handle errors from server
        eventSource.addEventListener('error', (e: MessageEvent) => {
          try {
            const errorData = JSON.parse(e.data) as { message?: string };
            setError(errorData.message || 'Stream error');
          } catch (err) {
            console.error('[LiveStream] Error parsing error event:', err);
          }
        });
      } catch (err) {
        console.error('[LiveStream] Connection error:', err);
        setError('Failed to connect to stream');
        // Fallback to polling
        const interval = setInterval(() => {
          router.refresh();
          onUpdate?.();
        }, 10000);
        return () => clearInterval(interval);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [roomId, router, onUpdate]);

  // Connection status indicator (optional, can be styled)
  return null; // Invisible component, just handles the stream
}

