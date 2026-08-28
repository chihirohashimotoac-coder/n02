import type { DisciplineResult, PentathlonSession, ResultUnit } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  results: [DisciplineResult | null, DisciplineResult | null];
  /** Which player, if any, won this discipline. */
  winner: 0 | 1 | null;
}

function unitLabel(unit: ResultUnit): string {
  switch (unit) {
    case 'darts':
      return 'DARTS';
    case 'points':
      return 'POINTS';
    case 'strokes':
      return 'STROKES';
    case 'runs':
      return 'RUNS';
  }
}

/**
 * The score a discipline is actually judged on. Disciplines measured in darts (501/301/RTC) are
 * judged on the dart count itself, which already has its own column - repeating it here as
 * "9 DARTS" next to a DARTS column reading "9" is the duplication this column deliberately avoids.
 */
function scoreText(result: DisciplineResult | null): string {
  if (!result) return '—';
  if (result.unit === 'darts') return '—';
  return `${result.value} ${unitLabel(result.unit)}`;
}

/**
 * One discipline's results. SCORE is the discipline's own measure and RESULT is completion state.
 * The third column is the dart count everywhere except in disciplines that report a stat of their
 * own instead (Cricket: MPR), which supply `result.stat` and rename the column with it.
 */
export default function DisciplineResultTable({ session, results, winner }: Props) {
  const stat = results.find((result) => result?.stat)?.stat;
  return (
    <div className="pent-result-table pent-result-table-4">
      <div className="pent-result-row head">
        <span className="name">PLAYER</span>
        <span>SCORE</span>
        <span>{stat ? stat.label : 'DARTS'}</span>
        <span>RESULT</span>
      </div>
      {(session.playerCount === 1 ? [0] : [0, 1]).map((index) => {
        const result = results[index];
        const isWinner = winner === index;
        return (
          <div className="pent-result-row" key={index}>
            <span className="name">
              {isWinner && (
                <i className="pent-win-mark" aria-hidden="true">
                  ★
                </i>
              )}
              {session.names[index]}
              {isWinner && <span className="sr-only">（この種目の勝者）</span>}
            </span>
            <span className={`value ${isWinner ? 'win' : ''}`}>{scoreText(result)}</span>
            <span className="value">
              {result?.stat ? (
                <span className="pent-result-stat">
                  <b>{result.stat.primary}</b>
                  {result.stat.primaryNote && <em>{result.stat.primaryNote}</em>}
                  {result.stat.secondary && <em>{result.stat.secondary}</em>}
                </span>
              ) : (
                (result?.darts ?? '—')
              )}
            </span>
            <span className="value">{result ? (result.completed ? 'COMPLETE' : 'DNF') : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}
