import { sidePanelId } from './x01StatsLayout';
import type { X01PlayerStatsDisplay, X01RateDisplay, X01StatsView } from '../domain/x01Stats';

type RowValue = string | number | X01RateDisplay;

interface Row {
  label: string;
  value: (stats: X01PlayerStatsDisplay) => RowValue;
}

const isRate = (value: RowValue): value is X01RateDisplay => typeof value === 'object';

/** n01's default rows, in the order the side columns show them. */
const BASIC_ROWS: Row[] = [
  { label: '3 Darts', value: (s) => s.average },
  { label: 'First 9', value: (s) => s.first9 },
  { label: 'Legs', value: (s) => s.legs },
  { label: '100+', value: (s) => s.ton00 },
  { label: '140+', value: (s) => s.ton40 },
  { label: "180's", value: (s) => s.ton80 },
  { label: 'High Finish', value: (s) => s.highFinish },
  { label: 'Best Leg', value: (s) => s.bestLeg },
];

/** What the full-width columns add; the compact ones leave these to the 詳細 dialog. */
const SIDE_EXTRA_ROWS: Row[] = [
  { label: 'Worst Leg', value: (s) => s.worstLeg },
  { label: 'Checkout 予測', value: (s) => s.checkout },
  { label: 'Keep', value: (s) => s.keep },
  { label: 'Break', value: (s) => s.break },
];

/** Every row of n01's stats page with Details open, in its order. */
const DETAIL_ROWS: Row[] = [
  { label: 'Legs', value: (s) => s.legs },
  { label: '3 Darts', value: (s) => s.average },
  { label: 'First 9', value: (s) => s.first9 },
  { label: '60+', value: (s) => s.s60 },
  { label: '80+', value: (s) => s.s80 },
  { label: '100+', value: (s) => s.ton00 },
  { label: '120+', value: (s) => s.ton20 },
  { label: '140+', value: (s) => s.ton40 },
  { label: '170+', value: (s) => s.ton70 },
  { label: "180's", value: (s) => s.ton80 },
  { label: 'High Finish', value: (s) => s.highFinish },
  { label: '100+ Finishes', value: (s) => s.highFinishCount },
  { label: 'Best Leg', value: (s) => s.bestLeg },
  { label: 'Worst Leg', value: (s) => s.worstLeg },
  { label: 'Checkout 予測', value: (s) => s.checkout },
  { label: 'Keep', value: (s) => s.keep },
  { label: 'Break', value: (s) => s.break },
];

function Figure({ value }: { value: RowValue }) {
  if (!isRate(value)) return <>{value}</>;
  return (
    <>
      <span className="x01-rate-percent">{value.percent}</span>
      <span className="x01-rate-fraction">
        ({value.numerator} / {value.denominator})
      </span>
    </>
  );
}

function Unreproducible({ reason }: { reason: string }) {
  return (
    <p className="x01-stats-unavailable" role="note">
      この保存データからは統計を再現できません。
      <small>{reason}</small>
    </p>
  );
}

interface SidePanelProps {
  player: 0 | 1;
  name: string;
  view: X01StatsView;
  compact: boolean;
  hidden: boolean;
  onOpenDetail: () => void;
}

/** One player's column beside the score sheet. Scrolls on its own when the column is short. */
export function X01StatsSidePanel({ player, name, view, compact, hidden, onOpenDetail }: SidePanelProps) {
  const rows = compact ? BASIC_ROWS : [...BASIC_ROWS, ...SIDE_EXTRA_ROWS];
  return (
    <aside
      id={sidePanelId(player)}
      className={`x01-side-stats ${player === 0 ? 'left' : 'right'}`}
      aria-label={`${name}の統計`}
      hidden={hidden}
      tabIndex={0}
    >
      <p className="x01-side-stats-title" aria-hidden="true">
        STATS
      </p>
      {view.ok ? (
        <dl>
          {rows.map((row) => {
            const value = row.value(view.players[player]);
            return (
              <div key={row.label} className={isRate(value) ? 'rate' : undefined}>
                <dt>{row.label}</dt>
                <dd>
                  <Figure value={value} />
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <Unreproducible reason={view.reason} />
      )}
      <button type="button" className="x01-side-stats-detail" onClick={onOpenDetail} aria-haspopup="dialog">
        詳細
      </button>
    </aside>
  );
}

/** The 詳細 dialog's body: both players side by side, every row of n01's Details view. */
export function X01StatsDetailTable({ names, view }: { names: [string, string]; view: X01StatsView }) {
  if (!view.ok) return <Unreproducible reason={view.reason} />;
  return (
    <div className="n01-stats-table">
      <div className="n01-stats-head">
        <strong>{names[0]}</strong>
        <span>DETAILS</span>
        <strong>{names[1]}</strong>
      </div>
      {DETAIL_ROWS.map((row) => {
        const values = view.players.map((stats) => row.value(stats));
        return (
          <div key={row.label} className={`n01-stats-row${isRate(values[0]) ? ' rate' : ''}`}>
            <strong>
              <Figure value={values[0]} />
            </strong>
            <span>{row.label}</span>
            <strong>
              <Figure value={values[1]} />
            </strong>
          </div>
        );
      })}
    </div>
  );
}
