import { describe, expect, it } from 'vitest';
import { deriveQuickTarget } from './quickTarget';
import { createRtcDoublesEngine } from '../../domain/pentathlon/engines/rtcDoubles';
import { golfEngine } from '../../domain/pentathlon/engines/golf';
import { halfItEngine } from '../../domain/pentathlon/engines/halfIt';
import { corkEngine } from '../../domain/pentathlon/engines/cork';
import type { DartHit } from '../../domain/darts';

const D = (value: number): DartHit => ({ kind: 'number', value, ring: 'double' });
const S = (value: number): DartHit => ({ kind: 'number', value, ring: 'single' });
const BULL: DartHit = { kind: 'bull', ring: 'inner' };
const MISS: DartHit = { kind: 'miss' };

describe('deriveQuickTarget', () => {
  it('Cork is always bull', () => {
    expect(deriveQuickTarget('cork', corkEngine.createState())).toEqual({ kind: 'bull' });
  });

  it('Golf targets the current hole and ignores pending hits (only the committed turn matters)', () => {
    const state = golfEngine.createState(); // hole 1
    expect(deriveQuickTarget('golf', state)).toEqual({ kind: 'number', number: 1 });
    // Staging a dart doesn't advance the hole until the turn is committed.
    expect(deriveQuickTarget('golf', state, [D(1)])).toEqual({ kind: 'number', number: 1 });
  });

  it('Half-It targets follow the fixed 9-round sequence and ignore pending hits', () => {
    const state = halfItEngine.createState(); // round 1 -> target 15
    expect(deriveQuickTarget('half-it', state)).toEqual({ kind: 'number', number: 15 });
    expect(deriveQuickTarget('half-it', state, [S(15)])).toEqual({ kind: 'number', number: 15 });

    // Round 3 (0-based index 2) is the documented "any double" round.
    const afterTwoRounds = halfItEngine.applyInput(
      halfItEngine.applyInput(halfItEngine.createState(), [MISS, MISS, MISS]),
      [MISS, MISS, MISS],
    );
    expect(deriveQuickTarget('half-it', afterTwoRounds)).toEqual({ kind: 'any-ring', ring: 'double' });
  });

  it('Half-It bull round maps to the bull quick target', () => {
    let state = halfItEngine.createState();
    for (let i = 0; i < 8; i++) state = halfItEngine.applyInput(state, [MISS, MISS, MISS]);
    expect(deriveQuickTarget('half-it', state)).toEqual({ kind: 'bull' });
  });

  it('returns null once the discipline is finished', () => {
    let state = golfEngine.createState();
    for (let hole = 1; hole <= 9; hole++) state = golfEngine.applyInput(state, [D(hole)]);
    expect(golfEngine.isFinished(state)).toBe(true);
    expect(deriveQuickTarget('golf', state)).toBeNull();
  });

  it('Baseball and Cricket keep the full grid (no QuickTarget)', () => {
    expect(deriveQuickTarget('baseball', {})).toBeNull();
    expect(deriveQuickTarget('cricket', {})).toBeNull();
  });

  describe('RTC-on-Doubles', () => {
    const engine = createRtcDoublesEngine({ dartLimit: 0 });

    it('targets D1 at the start', () => {
      expect(deriveQuickTarget('rtc-doubles', engine.createState())).toEqual({ kind: 'double', number: 1 });
    });

    it('previews the target advancing across darts staged within the SAME turn (not yet committed) - a player can legitimately hit D1, D2, D3 in one visit', () => {
      const state = engine.createState();
      expect(deriveQuickTarget('rtc-doubles', state, [])).toEqual({ kind: 'double', number: 1 });
      expect(deriveQuickTarget('rtc-doubles', state, [D(1)])).toEqual({ kind: 'double', number: 2 });
      expect(deriveQuickTarget('rtc-doubles', state, [D(1), D(2)])).toEqual({ kind: 'double', number: 3 });
    });

    it('a miss (or wrong number) within the turn does not advance the preview', () => {
      const state = engine.createState();
      expect(deriveQuickTarget('rtc-doubles', state, [D(1), MISS])).toEqual({ kind: 'double', number: 2 });
      expect(deriveQuickTarget('rtc-doubles', state, [D(1), S(2)])).toEqual({ kind: 'double', number: 2 });
    });

    it('matches the real engine result after committing the same darts', () => {
      const state = engine.createState();
      const pending: DartHit[] = [D(1), D(2), D(3)];
      const previewed = deriveQuickTarget('rtc-doubles', state, pending);
      const committed = engine.applyInput(state, pending);
      expect(previewed).toEqual({ kind: 'double', number: committed.targetIndex + 1 });
    });

    it('shows bull once the preview reaches the final target', () => {
      const state = engine.createState();
      const nineteenDoubles: DartHit[] = Array.from({ length: 19 }, (_, i) => D(i + 1));
      const almostThere = engine.applyInput(state, nineteenDoubles);
      expect(deriveQuickTarget('rtc-doubles', almostThere)).toEqual({ kind: 'double', number: 20 });
      expect(deriveQuickTarget('rtc-doubles', almostThere, [D(20)])).toEqual({ kind: 'bull' });
    });

    it('keeps showing bull instead of falling back to the full grid once staged darts already complete the clock', () => {
      const state = engine.createState();
      const twentyDoubles: DartHit[] = Array.from({ length: 20 }, (_, i) => D(i + 1));
      const readyForBull = engine.applyInput(state, twentyDoubles);
      expect(deriveQuickTarget('rtc-doubles', readyForBull, [BULL, MISS])).toEqual({ kind: 'bull' });
    });

    it('returns null once actually finished (committed)', () => {
      const state = engine.createState();
      const perfect: DartHit[] = [...Array.from({ length: 20 }, (_, i) => D(i + 1)), BULL];
      const finished = engine.applyInput(state, perfect);
      expect(engine.isFinished(finished)).toBe(true);
      expect(deriveQuickTarget('rtc-doubles', finished)).toBeNull();
    });
  });
});
