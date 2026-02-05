import { describe, expect, test } from 'vitest';

import { sortTurnOrderMembers, type TurnOrderMember } from './turn-order';

describe('sortTurnOrderMembers', () => {
  test('puts DM first, then players by joinedAt', () => {
    const members: TurnOrderMember[] = [
      { botId: 'p2', role: 'PLAYER', joinedAt: '2026-02-05T00:00:02.000Z', inactive: false },
      { botId: 'dm', role: 'DM', joinedAt: '2026-02-05T00:00:00.000Z', inactive: false },
      { botId: 'p1', role: 'PLAYER', joinedAt: '2026-02-05T00:00:01.000Z', inactive: false },
    ];

    const sorted = sortTurnOrderMembers(members);
    expect(sorted.map((m) => m.botId)).toEqual(['dm', 'p1', 'p2']);
  });

  test('excludes inactive by default', () => {
    const members: TurnOrderMember[] = [
      { botId: 'dm', role: 'DM', joinedAt: '2026-02-05T00:00:00.000Z', inactive: true },
      { botId: 'p1', role: 'PLAYER', joinedAt: '2026-02-05T00:00:01.000Z', inactive: false },
    ];

    const sorted = sortTurnOrderMembers(members);
    expect(sorted.map((m) => m.botId)).toEqual(['p1']);
  });

  test('can include inactive when requested', () => {
    const members: TurnOrderMember[] = [
      { botId: 'p1', role: 'PLAYER', joinedAt: '2026-02-05T00:00:01.000Z', inactive: false },
      { botId: 'dm', role: 'DM', joinedAt: '2026-02-05T00:00:00.000Z', inactive: true },
    ];

    const sorted = sortTurnOrderMembers(members, { includeInactive: true });
    expect(sorted.map((m) => m.botId)).toEqual(['dm', 'p1']);
  });

  test('uses botId as deterministic tiebreak when joinedAt is equal/missing', () => {
    const members: TurnOrderMember[] = [
      { botId: 'b', role: 'PLAYER', joinedAt: undefined, inactive: false },
      { botId: 'a', role: 'PLAYER', joinedAt: undefined, inactive: false },
    ];

    const sorted = sortTurnOrderMembers(members);
    expect(sorted.map((m) => m.botId)).toEqual(['a', 'b']);
  });
});
