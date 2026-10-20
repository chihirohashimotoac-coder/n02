import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  advanceLeg,
  applyVisit,
  createX01Match,
  declareDraw,
  editVisit,
  resolveRoundLimit,
  resumePreviousLeg,
  setLegStarter,
  swapCurrentLegScores,
  undoLastAction,
  type X01MatchState,
  type X01Settings,
} from './x01Engine';
import { buildN01Legs, computeN01PlayerStats, selectX01Stats, type N01BandMode, type N01Leg } from './x01Stats';
import { defaultSettings } from '../storage/matchStorage';

/**
 * x01Stats against n01 (Web) itself.
 *
 * Nothing here re-implements n01. The same throw record is entered twice: into n02's engine, and
 * into n01's own game script (n01.js: nextScore / finish / middle, driven through its own finish and
 * middle menus) running in a jsdom sandbox. Then
 *   1. the adapter's legData is compared with the legData n01 itself stored,
 *   2. n01's own calcPlayer() over ITS legData is compared with computeN01PlayerStats() over ours,
 *   3. n01's own stats page (stats.html + init()) is rendered and every figure it prints is compared
 *      with selectX01Stats(), in both its default and its Details view.
 *
 * The reference files are n01's and are not in this repository. `npm run test:n01` downloads them
 * (scripts/fetch-n01-reference.mjs) into node_modules/.cache/n01-reference, pinned by SHA-256:
 *   n01_stats.js ?a=16  e8764747bf9e24c8c216a608cedee25fbbf402ea86e00378e3a3840d110fdd5f
 *   n01.js       ?a=65  6144e48e4004249e3f7a557075643a58e1b2fd453164e4f72145f365025e89cd
 * Without them this suite is skipped (and says so); set N01_REFERENCE_REQUIRED=1 to make that a
 * failure instead. A file that is present but differs from the pin always fails.
 */

const referenceDir =
  process.env.N01_REFERENCE_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', '.cache', 'n01-reference');

const PINNED: Record<string, string> = {
  'n01_stats.js': 'e8764747bf9e24c8c216a608cedee25fbbf402ea86e00378e3a3840d110fdd5f',
  'n01.js': '6144e48e4004249e3f7a557075643a58e1b2fd453164e4f72145f365025e89cd',
  'n01_data.js': '5d351236d27e7333e3540551e4fc4c97834eb661b933661054c20c898fc27414',
  'n01_util.js': 'b0baa8a5107dd743af4ff26403e605aa300fbf9fb9f675d558f8404e5fc08b9d',
  'jquery-3.6.0.min.js': 'ff1523fb7389539c84c65aba19260648793bb4f5e29329d2ee8804bc37a3fe6e',
  'n01.html': 'eebd10f84a7bc58b677edbb148d62e331747210d8f149c937926c7d5def37bd7',
  'stats.html': '90ec10dfe0244a7e91444ce9c2892cc456c7dde4fb762a2314ddb3403956d7bf',
};

const missing = Object.keys(PINNED).filter((name) => !existsSync(join(referenceDir, name)));
if (missing.length > 0) {
  const message = `n01 reference files missing (${missing.join(', ')}): run \`npm run test:n01\`.`;
  if (process.env.N01_REFERENCE_REQUIRED === '1') throw new Error(message);
  console.warn(`[x01Stats.n01.test] SKIPPED - ${message}`);
}

const sources = new Map<string, string>();
function reference(name: string): string {
  let text = sources.get(name);
  if (text === undefined) {
    const bytes = readFileSync(join(referenceDir, name));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== PINNED[name]) throw new Error(`${name}: SHA-256 ${actual} is not the pinned ${PINNED[name]}`);
    text = bytes.toString('utf8');
    sources.set(name, text);
  }
  return text;
}

// ------------------------------------------------------------------ the n01 sandbox

interface JQuery {
  length: number;
  [index: number]: Element | undefined;
  click(): JQuery;
  text(): string;
  html(): string;
  html(content: string): JQuery;
  addClass(name: string): JQuery;
}

interface N01LiveLeg extends N01Leg {
  selectRound: number;
  selectPlayer: 0 | 1;
}

interface N01Window {
  eval(source: string): void;
  setTimeout(callback: () => void, ms: number): number;
  localStorage: Storage;
  jQuery: { fx: { off: boolean } };
  $: (selector: string) => JQuery;
  n01_util: { putDbData: (item: unknown) => void };
  n01_data: { setData: { legData: N01LiveLeg[] }; restoreSetData(): void };
  DOMParser: typeof DOMParser;
  init(): void;
  currentLegData(): N01LiveLeg;
  setCurrentScore(score: string): void;
  nextScore(): boolean;
  changeNextSelect(): void;
  changeSelectInput(round: number, player: 0 | 1): void;
  middleMenuOpen(): void;
  calcPlayer(stats: Record<string, number>, player: 0 | 1): void;
}

const tick = (window: N01Window, ms = 5) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Waits for n01's own jQuery-ready handlers, which run on a timer after the scripts load. */
async function ready(window: N01Window, isReady: () => boolean) {
  for (let i = 0; i < 400 && !isReady(); i++) await tick(window, 10);
  if (!isReady()) throw new Error('n01 page did not finish initialising');
}

function sandbox(page: string, url: string): { window: N01Window; errors: Error[] } {
  const errors: Error[] = [];
  const virtualConsole = new VirtualConsole().on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(reference(page), { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  return { window: dom.window as N01Window, errors };
}

const N01_OPTIONS = {
  keyShow: 0,
  leftShow: 1,
  roundDarts: 1,
  circleTon: 1,
  avePPR: 1,
  smallKeypad: 0,
  inputTag: 0,
  inputLeft: 0,
  inputLeftCom: 0,
};

/** n01's game screen, mid-game, with both players at the given start. */
async function openN01Game(starts: [number, number], roundLimit: number | null) {
  const { window: w, errors } = sandbox('n01.html', 'https://n01darts.com/n01/web/n01.html');
  w.localStorage.setItem('options', JSON.stringify(N01_OPTIONS));
  w.localStorage.setItem(
    'gameOptions',
    JSON.stringify({
      playerName: ['P1', 'P2'],
      startScore: starts[0],
      roundLimit: roundLimit === null ? 0 : 1,
      maxRound: roundLimit ?? 15,
      p1_handicap: 0,
      p1_handicap_score: 501,
      p2_handicap: 0,
      p2_handicap_score: 501,
      com: [0, 0],
      comLevel: [1, 1],
      cricketRoundLimit: 0,
      cricketMaxRound: 20,
      cricketOverkill: 0,
    }),
  );
  w.localStorage.setItem(
    'setData',
    JSON.stringify({
      match_type: '01',
      inGame: true,
      startTime: 0,
      currnetInput: '',
      leftMode: 0,
      leftModeError: 0,
      currentLeg: 0,
      legData: [
        {
          first: 0,
          currentRound: 0,
          currentPlayer: 0,
          selectRound: 0,
          selectPlayer: 0,
          endFlag: 0,
          middleForDiddle: 0,
          winner: -1,
          playerData: [[{ score: 0, left: starts[0] }], [{ score: 0, left: starts[1] }]],
        },
      ],
      statsData: [
        { name: 'P1', winLegs: 0 },
        { name: 'P2', winLegs: 0 },
      ],
    }),
  );
  w.eval(reference('jquery-3.6.0.min.js'));
  w.jQuery.fx.off = true;
  w.eval(reference('n01_util.js'));
  // n01 archives a finished set to IndexedDB, which jsdom does not have. It is not part of legData.
  w.n01_util.putDbData = () => {};
  w.eval(reference('n01_data.js'));
  w.eval(reference('n01.js'));
  // n01's pure layout helpers only measure the window and place elements; they never read or write
  // legData, and jsdom has no layout to give them. Skipping them keeps each record to a fraction
  // of the time. Every function that stores a visit, a finish or a leg end runs as published.
  for (const name of ['resize', 'scrollRound', 'scrollTop', 'centeringObject']) (w as unknown as Record<string, () => void>)[name] = () => {};
  await ready(w, () => w.$('#score_body tr').length > 0);
  return { w, errors };
}

/** n01's stats page over the given set data, in its default view or with Details open. */
async function loadN01Stats(setData: string, mode: N01BandMode) {
  const { window: w, errors } = sandbox('stats.html', 'https://n01darts.com/n01/web/n01_v2/stats.html');
  w.localStorage.setItem('options', JSON.stringify({ ...N01_OPTIONS, showDetail: mode === 'details' ? 1 : 0 }));
  w.localStorage.setItem('setData', setData);
  w.eval(reference('jquery-3.6.0.min.js'));
  w.jQuery.fx.off = true;
  w.eval(reference('n01_util.js'));
  w.eval(reference('n01_data.js'));
  w.eval(reference('n01_stats.js'));
  await ready(w, () => w.$('#p1_name').text() === 'P1');
  const article = new w.DOMParser().parseFromString(reference('stats.html'), 'text/html').getElementById('article')!.innerHTML;
  return { w, errors, article };
}

const statsPages = new Map<N01BandMode, ReturnType<typeof loadN01Stats>>();

/**
 * Shows a record on n01's stats page. The page is loaded once per view; each record then starts
 * from stats.html's own markup again - n01 leaves a figure as it is when its condition does not
 * hold, so nothing from the previous record may show through - and n01's own init() fills it in.
 */
async function openN01Stats(setData: string, mode: N01BandMode) {
  let page = statsPages.get(mode);
  if (!page) {
    page = loadN01Stats(setData, mode);
    statsPages.set(mode, page);
  }
  const { w, errors, article } = await page;
  w.$('#article').html(article);
  if (mode === 'details') w.$('.accordion').addClass('open');
  w.localStorage.setItem('setData', setData);
  w.n01_data.restoreSetData();
  w.init();
  return { w, errors };
}

// ------------------------------------------------------------------ one record, entered into both

type Visit = number | [score: number, darts: number];

interface LegScript {
  /** チェックアウト練習: the leg's challenge. */
  target?: number;
  /** Hands the empty leg to this player first (n02 setLegStarter / n01's swap on the first input). */
  starter?: 0 | 1;
  /** Entered scores in throwing order; a pair carries 使用ダーツ, or the darts of the finish. */
  visits: Visit[];
  /** A leg that ends without a checkout. */
  end?: { draw: true } | { decide: 0 | 1 | 'draw' };
}

interface Scenario {
  mode?: '01' | 'checkout';
  startScore?: number;
  handicap?: [number | null, number | null];
  roundLimit?: number;
  targetLegs?: number;
  legs: LegScript[];
}

function settingsFor(scenario: Scenario): X01Settings {
  const base = defaultSettings();
  const target = scenario.legs[0]?.target ?? 100;
  return {
    ...base,
    mode: scenario.mode ?? '01',
    startScore: scenario.startScore ?? 501,
    checkoutMin: target,
    checkoutMax: target,
    targetLegs: scenario.targetLegs ?? 0,
    roundLimit: scenario.roundLimit !== undefined,
    maxRounds: scenario.roundLimit ?? 15,
    handicapEnabled: [scenario.handicap?.[0] != null, scenario.handicap?.[1] != null],
    handicapScores: [scenario.handicap?.[0] ?? 501, scenario.handicap?.[1] ?? 501],
  };
}

function enterN02(state: X01MatchState, [score, darts]: [number, number | undefined]): X01MatchState {
  const remaining = state.players[state.active].remaining;
  return score === remaining ? applyVisit(state, score, darts ?? 3) : applyVisit(state, score, undefined, darts);
}

function legStartN02(state: X01MatchState, leg: LegScript, index: number): X01MatchState {
  let next = state;
  if (index > 0) {
    // Fix the next challenge by narrowing the range for this one advanceLeg(): the engine still
    // draws it, from a range of one.
    if (leg.target !== undefined) next = { ...next, settings: { ...next.settings, checkoutMin: leg.target, checkoutMax: leg.target } };
    next = advanceLeg(next);
  }
  if (leg.starter !== undefined) next = setLegStarter(next, leg.starter);
  return next;
}

function endN02(state: X01MatchState, end: LegScript['end']): X01MatchState {
  if (!end) return state;
  if ('draw' in end) return declareDraw(state);
  return resolveRoundLimit(state, end.decide);
}

function playN02(scenario: Scenario): X01MatchState {
  let state = createX01Match(settingsFor(scenario));
  scenario.legs.forEach((leg, index) => {
    state = legStartN02(state, leg, index);
    for (const visit of leg.visits) state = enterN02(state, typeof visit === 'number' ? [visit, undefined] : visit);
    state = endN02(state, leg.end);
  });
  return state;
}

function legStarts(scenario: Scenario, leg: LegScript): [number, number] {
  if (scenario.mode === 'checkout') return [leg.target!, leg.target!];
  const start = scenario.startScore ?? 501;
  return [scenario.handicap?.[0] ?? start, scenario.handicap?.[1] ?? start];
}

/**
 * Enters the record into n01 the way an n01 player would: a bust is entered as 0, a finish as the
 * remaining followed by the dart it went in on, and a leg without a checkout through n01's own end
 * menu. 使用ダーツ has no n01 counterpart and is dropped.
 */
async function playN01(scenario: Scenario) {
  const { w, errors } = await openN01Game(legStarts(scenario, scenario.legs[0]), scenario.roundLimit ?? null);
  const finishButtons = ['#finish_first', '#finish_second', '#finish_third'];
  for (const leg of scenario.legs) {
    const live = w.currentLegData();
    const [s0, s1] = legStarts(scenario, leg);
    live.playerData[0][0].left = s0;
    live.playerData[1][0].left = s1;
    if (leg.starter !== undefined && live.first !== leg.starter) w.changeSelectInput(0, leg.starter);
    for (const visit of leg.visits) {
      const [score, darts] = typeof visit === 'number' ? [visit, 3] : visit;
      const current = w.currentLegData();
      const left = current.playerData[current.selectPlayer][current.selectRound].left;
      if (score === left) {
        w.setCurrentScore(String(score));
        expect(w.nextScore()).toBe(false); // opens n01's finish menu
        w.$(finishButtons[darts - 1]).click();
        w.$('#msg_ok').click();
        continue;
      }
      const bust = score > left || left - score === 1;
      w.setCurrentScore(String(bust ? 0 : score));
      if (w.nextScore() !== false) w.changeNextSelect();
    }
    if (leg.end) {
      if (!w.$('#modal-overlay')[0]) w.middleMenuOpen();
      const outcome = 'draw' in leg.end ? 'draw' : leg.end.decide;
      w.$(outcome === 'draw' ? '#middle_draw' : outcome === 0 ? '#middle_p1win' : '#middle_p2win').click();
      w.$('#msg_ok').click();
    }
    await tick(w);
  }
  await tick(w, 250); // let n01's own deferred redraws run, so any error they raise is caught
  return { w, errors };
}

const LEG_FIELDS = ['first', 'currentRound', 'currentPlayer', 'endFlag', 'middleForDiddle', 'winner', 'playerData'] as const;
const pick = (leg: N01Leg) => Object.fromEntries(LEG_FIELDS.map((field) => [field, leg[field]]));

const STAT_TEMPLATE = {
  winLegs: 0,
  s60Count: 0,
  s80Count: 0,
  ton00Count: 0,
  ton20Count: 0,
  ton40Count: 0,
  ton70Count: 0,
  ton80Count: 0,
  highOut: 0,
  highOutCount: 0,
  bestLeg: 0,
  worstLeg: 0,
  allScore: 0,
  allDarts: 0,
  winDarts: 0,
  winCount: 0,
  first9Score: 0,
  first9Darts: 0,
  checkout: 0,
  breakCnt: 0,
  secondCnt: 0,
};

/** Every figure n01's stats page prints for one player, read off the rendered page. */
function n01Printed(w: N01Window, player: 0 | 1) {
  const p = `#p${player + 1}`;
  const side = player === 0 ? 'left' : 'right';
  const text = (selector: string) => w.$(selector).text();
  return {
    legs: text(`${p}_legs`),
    average: text(`${p}_score`),
    first9: text(`${p}_first9`),
    s60: text(`${p}_60`),
    s80: text(`${p}_80`),
    ton00: text(`${p}_ton00`),
    ton20: text(`${p}_ton20`),
    ton40: text(`${p}_ton40`),
    ton70: text(`${p}_ton70`),
    ton80: text(`${p}_ton80`),
    highFinish: text(`${p}_highout`),
    highFinishCount: text(`${p}_highout_count`),
    bestLeg: text(`${p}_best`),
    worstLeg: text(`${p}_worst`),
    checkout: w.$(`.checkout .${side}`).html(),
    keep: w.$(`.keep .${side}`).html(),
    break: w.$(`.break .${side}`).html(),
  };
}

/** The same figures from n02's selector, in n01's printed form. */
function n02Printed(state: X01MatchState, mode: N01BandMode, player: 0 | 1) {
  const view = selectX01Stats(state, mode);
  if (!view.ok) throw new Error(view.reason);
  const s = view.players[player];
  const rate = (r: { percent: string; numerator: number; denominator: number }) =>
    `${r.percent}<br>(${r.numerator} / ${r.denominator})`;
  return {
    legs: String(s.legs),
    average: s.average,
    first9: s.first9,
    s60: String(s.s60),
    s80: String(s.s80),
    ton00: String(s.ton00),
    ton20: String(s.ton20),
    ton40: String(s.ton40),
    ton70: String(s.ton70),
    ton80: String(s.ton80),
    highFinish: String(s.highFinish),
    highFinishCount: String(s.highFinishCount),
    bestLeg: String(s.bestLeg),
    worstLeg: String(s.worstLeg),
    checkout: rate(s.checkout),
    keep: rate(s.keep),
    break: rate(s.break),
  };
}

/**
 * The whole comparison for one record. `state` defaults to the record played straight through;
 * the Undo / correction / rewind cases pass the state they reached by another route.
 */
async function expectMatchesN01(scenario: Scenario, state: X01MatchState = playN02(scenario)) {
  const game = await playN01(scenario);
  expect(game.errors).toEqual([]);

  // 1. legData
  const built = buildN01Legs(state);
  if (!built.ok) throw new Error(built.reason);
  const theirs = structuredClone(game.w.n01_data.setData.legData) as N01Leg[];
  expect(built.legs.map(pick)).toEqual(theirs.slice(0, built.legs.length).map(pick));
  // n01 opens the next leg the moment one ends; n02 waits on the Leg結果 dialog. Only an empty leg
  // may be left over.
  for (const extra of theirs.slice(built.legs.length)) {
    expect(extra.endFlag).toBe(0);
    expect(extra.playerData.map((rounds) => rounds.length)).toEqual([1, 1]);
  }

  const setData = JSON.stringify(game.w.n01_data.setData);
  for (const mode of ['basic', 'details'] as const) {
    const page = await openN01Stats(setData, mode);
    expect(page.errors).toEqual([]);
    for (const player of [0, 1] as const) {
      // 2. internal totals: n01's calcPlayer over n01's legData, against ours over the adapter's.
      const reference = structuredClone(STAT_TEMPLATE);
      page.w.calcPlayer(reference, player);
      expect(computeN01PlayerStats(built.legs, player, mode)).toEqual(reference);
      // 3. what is printed
      expect(n02Printed(state, mode, player)).toEqual(n01Printed(page.w, player));
    }
  }
  return { state, built };
}

// ------------------------------------------------------------------ cases

describe.skipIf(missing.length > 0)('x01Stats matches n01 (Web) n01_stats.js ?a=16', { timeout: 120_000 }, () => {
  it('uses exactly the pinned reference files', () => {
    for (const name of Object.keys(PINNED)) expect(() => reference(name)).not.toThrow();
  });

  it('a brand-new match: nothing thrown, every figure at n01\'s initial value', async () => {
    const { state } = await expectMatchesN01({ legs: [{ visits: [] }] });
    const view = selectX01Stats(state, 'details');
    expect(view.ok && view.players[0]).toMatchObject({
      average: '0.00',
      first9: '0.00',
      legs: 0,
      highFinish: 0,
      bestLeg: 0,
      worstLeg: 0,
      checkout: { percent: '0.0%', numerator: 0, denominator: 0 },
      keep: { percent: '0.0%', numerator: 0, denominator: 0 },
      break: { percent: '0.0%', numerator: 0, denominator: 0 },
    });
  });

  it('a leg in progress, both while the second thrower is up and once the round is complete', async () => {
    await expectMatchesN01({ legs: [{ visits: [60, 45, 100] }] });
    await expectMatchesN01({ legs: [{ visits: [60, 45, 100, 26] }] });
  });

  it('reference case: 80 -> 40 alone gives a Checkout Prediction denominator of 0', async () => {
    const { state } = await expectMatchesN01({ startScore: 80, legs: [{ visits: [40] }] });
    const view = selectX01Stats(state, 'details');
    expect(view.ok && view.players[0].checkout).toEqual({ percent: '0.0%', numerator: 0, denominator: 0 });
  });

  it('reference case: a 0 from 40 on the second visit adds 3 to the denominator', async () => {
    const scenario: Scenario = { startScore: 80, legs: [{ visits: [40, 20, 0] }] };
    const { built } = await expectMatchesN01(scenario);
    expect(computeN01PlayerStats(built.legs, 0, 'details').checkout).toBe(3);
  });

  it('reference case: 80 -> 40 -> checkout on the 3rd dart gives a denominator of 3', async () => {
    const { state, built } = await expectMatchesN01({ startScore: 80, legs: [{ visits: [40, 20, [40, 3]] }] });
    expect(computeN01PlayerStats(built.legs, 0, 'details').checkout).toBe(3);
    const view = selectX01Stats(state, 'details');
    expect(view.ok && view.players[0].checkout).toEqual({ percent: '33.3%', numerator: 1, denominator: 3 });
  });

  it('reference case: a decision after one ordinary visit is a 4-dart Best / Worst Leg', async () => {
    const { state } = await expectMatchesN01({ roundLimit: 1, legs: [{ visits: [60, 41], end: { decide: 0 } }] });
    const view = selectX01Stats(state, 'details');
    expect(view.ok && [view.players[0].bestLeg, view.players[0].worstLeg, view.players[0].highFinish]).toEqual([4, 4, 0]);
  });

  it('every score band boundary, as visits and as checkout points, in both views', async () => {
    // 1101 leaves room for every band in one leg (169 and 179 cannot be scored in three darts, so
    // 168 and 177 are the tops of their bands); the checkouts then cover the finish bands.
    await expectMatchesN01({
      startScore: 1101,
      legs: [
        { visits: [59, 140, 60, 168, 79, 170, 80, 177, 99, 180, 100, 1, 119, 1, 120, 1, 139, 1] },
      ],
    });
    for (const finish of [60, 80, 100, 120, 140, 170]) {
      await expectMatchesN01({ startScore: finish, legs: [{ visits: [[finish, finish <= 40 || finish === 50 ? 1 : 3]] }] });
    }
    await expectMatchesN01({
      startScore: 301,
      legs: [
        { visits: [161, 100, [140, 3]] },
        { visits: [180, 100, 21, 100, 98, [101, 3]] },
        { visits: [100, 100, 100, 100, 41, 41, [60, 2]] },
      ],
    });
  });

  it('busts: over the remaining, and leaving 1', async () => {
    await expectMatchesN01({ startScore: 101, legs: [{ visits: [60, 100, 140, 1, 40, 50, [41, 3]] }] });
    await expectMatchesN01({ startScore: 101, legs: [{ visits: [60, 60, 40, 39, [41, 2]] }] });
  });

  it('1- and 2-dart ordinary visits still count as three darts; finishes on 1, 2 and 3 darts', async () => {
    const scenario: Scenario = {
      startScore: 170,
      legs: [
        { visits: [[100, 2], [60, 1], [20, 2], [70, 1], [50, 1]] },
        { visits: [[130, 1], [100, 2], [40, 2]] },
        { visits: [100, 140, [70, 3]] },
      ],
    };
    const { state, built } = await expectMatchesN01(scenario);
    // The engine keeps the darts that were used; the statistics count n01's way.
    expect(state.players[0].totalDarts).toBe(2 + 2 + 1 + 2 + 3 + 3);
    expect(computeN01PlayerStats(built.legs, 0, 'basic').allDarts).toBe(2 * 3 + 1 + 3 + 3 + 3);
  });

  it('first and second thrower across legs, with a changed starter, Keep and Break', async () => {
    await expectMatchesN01({
      startScore: 101,
      legs: [
        { visits: [60, 60, [41, 2]] },
        { visits: [100, 60, 1, [41, 3]] },
        { starter: 1, visits: [60, [101, 3]] },
        { visits: [0, 0, [101, 3]] },
        { visits: [20] },
      ],
    });
  });

  it('decisions and draws: round limit win / draw, and a draw declared mid-round', async () => {
    await expectMatchesN01({
      startScore: 501,
      roundLimit: 3,
      legs: [
        { visits: [60, 41, 100, 100, 26, 140], end: { decide: 1 } },
        { visits: [60, 41, 100, 100, 26, 140], end: { decide: 'draw' } },
        { visits: [180, 60, 180, 60, 100, 60], end: { decide: 0 } },
        { visits: [100] },
      ],
    });
    // Mid-round: the first thrower has thrown in a round the second never reached. n01 cuts it.
    await expectMatchesN01({
      startScore: 501,
      legs: [{ visits: [100, 60, 140], end: { draw: true } }, { visits: [45, 45, 45, 45], end: { draw: true } }, { visits: [] }],
    });
  });

  it('a negative Keep denominator from draws is printed as n01 prints it, not clamped', async () => {
    const { state } = await expectMatchesN01({
      startScore: 501,
      legs: [
        { visits: [60], end: { draw: true } },
        { visits: [60, 60], end: { draw: true } },
        { visits: [60], end: { draw: true } },
        { visits: [] },
      ],
    });
    const view = selectX01Stats(state, 'details');
    expect(view.ok && view.players[0].keep.denominator).toBeLessThan(0);
  });

  it('handicap starts', async () => {
    await expectMatchesN01({
      startScore: 501,
      handicap: [301, null],
      legs: [{ visits: [100, 140, 100, 140, [101, 3]] }, { visits: [180, 60, 121] }],
    });
  });

  it('チェックアウト練習: a different challenge every leg', async () => {
    await expectMatchesN01({
      mode: 'checkout',
      legs: [
        { target: 121, visits: [60, 81, [61, 3]] },
        { target: 40, visits: [[40, 1]] },
        { target: 170, visits: [100, [170, 3]] },
        { target: 99, visits: [0, 39] },
      ],
    });
  });

  it('just finished: the Leg結果 is up and the leg is counted once', async () => {
    const { state } = await expectMatchesN01({ startScore: 101, legs: [{ visits: [60, 60, [41, 2]] }] });
    expect(state.legResult).not.toBeNull();
    const view = selectX01Stats(state, 'basic');
    expect(view.ok && view.players[0].legs).toBe(1);
  });

  it('after Undo, recalculated from the state it returns to', async () => {
    const scenario: Scenario = { startScore: 101, legs: [{ visits: [60, 60, 1] }] };
    let state = playN02({ startScore: 101, legs: [{ visits: [60, 60, [41, 2]] }] });
    state = undoLastAction(state); // un-finishes the leg
    state = applyVisit(state, 1);
    await expectMatchesN01(scenario, state);
  });

  it('after a past-score correction, including one that turns into the checkout', async () => {
    let state = playN02({ startScore: 301, legs: [{ visits: [60, 45, 100, 26] }] });
    state = editVisit(state, 1, 140, 3);
    await expectMatchesN01({ startScore: 301, legs: [{ visits: [60, 140, 100, 26] }] }, state);

    let finishing = playN02({ startScore: 101, legs: [{ visits: [60, 20, 20] }] });
    finishing = editVisit(finishing, 2, 41, 2);
    expect(finishing.legResult?.reason).toBe('checkout');
    await expectMatchesN01({ startScore: 101, legs: [{ visits: [60, 20, [41, 2]] }] }, finishing);
  });

  it('after 前のLegをやり直す and a different deciding visit', async () => {
    let state = playN02({ startScore: 101, legs: [{ visits: [60, 60, [41, 2]] }, { visits: [100, 20] }] });
    state = resumePreviousLeg(state);
    state = applyVisit(state, 21);
    state = applyVisit(state, 41, 2);
    await expectMatchesN01({ startScore: 101, legs: [{ visits: [60, 60, 21, [41, 2]] }] }, state);
  });

  it('after プレイヤーのスコアを入れ替え', async () => {
    let state = playN02({ startScore: 501, legs: [{ visits: [100, 60, 140] }] });
    state = swapCurrentLegScores(state);
    await expectMatchesN01({ startScore: 501, legs: [{ starter: 1, visits: [100, 60, 140] }] }, state);
  });

  it('a won match: the result card and the play screen read the same figures', async () => {
    const { state } = await expectMatchesN01({
      startScore: 101,
      targetLegs: 2,
      legs: [{ visits: [60, 60, [41, 2]] }, { visits: [100, 60, 41, [41, 3]] }],
    });
    expect(state.matchWinner).toBe(0);
  });
});

describe('buildN01Legs: saves it cannot reproduce', () => {
  const played = () => playN02({ startScore: 101, legs: [{ visits: [60, 60, [41, 2]] }, { visits: [40] }] });

  it('says so instead of filling in zeros', () => {
    const cases: Array<[string, (state: X01MatchState) => unknown]> = [
      ['no restore', (s) => ({ ...s, completed: [{ ...s.completed[0], restore: undefined }] })],
      ['no reason', (s) => ({ ...s, completed: [{ ...s.completed[0], reason: undefined }] })],
      ['no legDarts', (s) => ({ ...s, completed: [{ ...s.completed[0], restore: { ...s.completed[0].restore, legDarts: undefined } }] })],
      ['no playerStartScores', (s) => ({ ...s, playerStartScores: undefined })],
      ['finish of 0 darts', (s) => ({ ...s, completed: [{ ...s.completed[0], darts: s.completed[0].restore.legDarts[0] }] })],
      ['finish of 4 darts', (s) => ({ ...s, completed: [{ ...s.completed[0], darts: s.completed[0].restore.legDarts[0] + 4 }] })],
      ['broken chain', (s) => ({ ...s, visits: [{ ...s.visits[0], after: 1 }] })],
    ];
    for (const [label, corrupt] of cases) {
      const state = corrupt(played()) as X01MatchState;
      const built = buildN01Legs(state);
      expect(built.ok, label).toBe(false);
      const view = selectX01Stats(state, 'basic');
      expect(view.ok, label).toBe(false);
    }
  });

  it('never writes to the state it reads', () => {
    const state = played();
    const before = JSON.stringify(state);
    selectX01Stats(state, 'basic');
    selectX01Stats(state, 'details');
    expect(JSON.stringify(state)).toBe(before);
  });
});
