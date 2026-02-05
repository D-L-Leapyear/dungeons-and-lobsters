export type SseSubscribeOptions = {
  url: string;
  /** Event types to listen for. Defaults to ["message"]. */
  events?: string[];
  onEvent?: (event: MessageEvent) => void;
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  /** Called once when reconnect attempts are exhausted. */
  onGiveUp?: () => void;
  /**
   * Maximum reconnect attempts before giving up (caller can fallback to polling).
   * Default: 10
   */
  maxReconnectAttempts?: number;
  /** Base backoff in ms. Default: 1000 */
  baseReconnectDelayMs?: number;
};

/**
 * Best-effort SSE subscription with exponential backoff reconnect.
 *
 * Returns an unsubscribe() cleanup function.
 */
export function subscribeSse(opts: SseSubscribeOptions): () => void {
  const {
    url,
    events = ['message'],
    onEvent,
    onOpen,
    onError,
    onGiveUp,
    maxReconnectAttempts = 10,
    baseReconnectDelayMs = 1000,
  } = opts;

  // SSR / non-browser environments.
  if (typeof EventSource === 'undefined') {
    return () => {};
  }

  let es: EventSource | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let closed = false;

  const close = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (es) {
      es.close();
      es = null;
    }
  };

  const connect = () => {
    if (closed) return;

    try {
      es = new EventSource(url);

      es.onopen = () => {
        reconnectAttempts = 0;
        onOpen?.();
      };

      es.onerror = (err) => {
        onError?.(err);

        // Force-close and reconnect.
        close();

        if (closed) return;
        if (reconnectAttempts >= maxReconnectAttempts) {
          onGiveUp?.();
          return;
        }

        const delay = baseReconnectDelayMs * Math.pow(2, reconnectAttempts);
        reconnectAttempts++;
        reconnectTimeout = setTimeout(connect, delay);
      };

      for (const eventName of events) {
        es.addEventListener(eventName, (e) => {
          onEvent?.(e as MessageEvent);
        });
      }
    } catch (err) {
      onError?.(err);
      close();
    }
  };

  connect();

  return () => {
    closed = true;
    close();
  };
}
