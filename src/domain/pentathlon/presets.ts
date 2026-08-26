import { createX01SoloEngine } from './engines/x01Solo';
import { halfItEngine } from './engines/halfIt';
import { createRtcDoublesEngine } from './engines/rtcDoubles';
import { golfEngine } from './engines/golf';
import { corkEngine } from './engines/cork';
import { baseballEngine } from './engines/baseball';
import { cricketEngine } from './engines/cricket';
import type { DisciplineEngine, DisciplineId, PentathlonPreset } from './types';

const x01_501 = createX01SoloEngine({
  id: 'x01-501',
  name: '501',
  startScore: 501,
  doubleIn: false,
  roundLimit: 0,
});

// 301 in a competitive pentathlon context is double-in/double-out with a 13-round limit
// (see docs/pentathlon-rules.md). The plain 通常01 mode is unaffected by this - it uses x01Engine.
const x01_301 = createX01SoloEngine({
  id: 'x01-301',
  name: '301',
  startScore: 301,
  doubleIn: true,
  roundLimit: 13,
});

const rtcDoubles = createRtcDoublesEngine({ dartLimit: 0 });

export const ENGINES: Record<DisciplineId, DisciplineEngine<never, never>> = {
  'x01-501': x01_501 as unknown as DisciplineEngine<never, never>,
  'x01-301': x01_301 as unknown as DisciplineEngine<never, never>,
  'half-it': halfItEngine as unknown as DisciplineEngine<never, never>,
  'rtc-doubles': rtcDoubles as unknown as DisciplineEngine<never, never>,
  golf: golfEngine as unknown as DisciplineEngine<never, never>,
  cork: corkEngine as unknown as DisciplineEngine<never, never>,
  baseball: baseballEngine as unknown as DisciplineEngine<never, never>,
  cricket: cricketEngine as unknown as DisciplineEngine<never, never>,
};

export interface PresetDefinition {
  id: PentathlonPreset;
  name: string;
  subtitle: string;
  description: string;
  disciplines: DisciplineId[];
}

export const PRESETS: Record<PentathlonPreset, PresetDefinition> = {
  jda: {
    id: 'jda',
    name: 'JDA',
    subtitle: 'Japan Darts Association',
    description: '501 / Half-It / On Doubles / Golf / 301',
    disciplines: ['x01-501', 'half-it', 'rtc-doubles', 'golf', 'x01-301'],
  },
  n01: {
    id: 'n01',
    name: 'n01 / i-Pentathlon',
    subtitle: 'Cork · 301 · Baseball · 501 · Cricket',
    description: 'Cork / 301 / Baseball / 501 / Cricket',
    disciplines: ['cork', 'x01-301', 'baseball', 'x01-501', 'cricket'],
  },
};

export function getEngine(id: DisciplineId): DisciplineEngine<never, never> {
  return ENGINES[id];
}

export function presetDisciplines(preset: PentathlonPreset): DisciplineId[] {
  return PRESETS[preset].disciplines;
}
