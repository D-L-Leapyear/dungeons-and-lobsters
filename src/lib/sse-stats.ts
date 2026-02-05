type RoomId = string;

export type SseStatsSnapshot = {
  activeTotal: number;
  byRoom: Record<RoomId, number>;
};

type SseStatsStore = {
  activeTotal: number;
  byRoom: Map<RoomId, number>;
};

function getStore(): SseStatsStore {
  const g = globalThis as unknown as { __DL_SSE_STATS__?: SseStatsStore };
  if (!g.__DL_SSE_STATS__) {
    g.__DL_SSE_STATS__ = { activeTotal: 0, byRoom: new Map() };
  }
  return g.__DL_SSE_STATS__;
}

export function sseStreamOpened(roomId: RoomId) {
  const store = getStore();
  store.activeTotal += 1;
  store.byRoom.set(roomId, (store.byRoom.get(roomId) ?? 0) + 1);
}

export function sseStreamClosed(roomId: RoomId) {
  const store = getStore();
  store.activeTotal = Math.max(0, store.activeTotal - 1);
  const next = Math.max(0, (store.byRoom.get(roomId) ?? 0) - 1);
  if (next === 0) store.byRoom.delete(roomId);
  else store.byRoom.set(roomId, next);
}

export function getSseStatsSnapshot(): SseStatsSnapshot {
  const store = getStore();
  return {
    activeTotal: store.activeTotal,
    byRoom: Object.fromEntries(store.byRoom.entries()),
  };
}
