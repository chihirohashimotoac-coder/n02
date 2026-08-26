import { getEngine, presetDisciplines } from '../../domain/pentathlon/presets';
import { computeNextStarter } from '../../domain/pentathlon/session';
import type { PentathlonSession } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onNext: () => void;
  onUndo: () => void;
  canUndo: boolean;
}

export default function DisciplineResult({ session, onNext, onUndo, canUndo }: Props) {
  const record = session.records[session.records.length - 1];
  if (!record) return null;

  const engine = getEngine(record.id);
  const disciplines = presetDisciplines(session.preset);
  const nextId = disciplines[session.currentDisciplineIndex + 1];
  const isLast = !nextId;

  const nextStarter =
    session.playerCount === 2 && !isLast
      ? computeNextStarter(session.starterMode, session.currentStarter, record.outcome)
      : null;

  return (
    <div className="pent-play">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DISCIPLINE COMPLETE</p>
          <h1>{engine.meta.name}</h1>
        </div>
      </div>

      <div className="pent-result-table">
        <div className="pent-result-row head">
          <span className="name">PLAYER</span>
          <span>RESULT</span>
          <span>DARTS</span>
        </div>
        {(session.playerCount === 1 ? [0] : [0, 1]).map((index) => {
          const result = record.results[index];
          const isWinner =
            (index === 0 && record.outcome === 'p0') || (index === 1 && record.outcome === 'p1');
          return (
            <div className="pent-result-row" key={index}>
              <span className="name">{session.names[index]}</span>
              <span className={`value ${isWinner ? 'win' : ''}`}>
                {isWinner && (
                  <i className="pent-win-mark" aria-hidden="true">
                    ★
                  </i>
                )}
                {result?.label ?? '—'}
                {isWinner && <span className="sr-only">（この種目の勝者）</span>}
              </span>
              <span className="value">{result?.darts ?? '—'}</span>
            </div>
          );
        })}
      </div>

      {session.playerCount === 2 && (
        <div className="pent-next-starter">
          <span>WINNER</span>
          <strong>
            {record.outcome === 'draw'
              ? '引き分け'
              : record.outcome === 'p0'
                ? session.names[0]
                : session.names[1]}
          </strong>
        </div>
      )}

      {nextStarter !== null && (
        <div className="pent-next-starter">
          <span>NEXT DISCIPLINE・{getEngine(nextId).meta.name}</span>
          <strong>{session.names[nextStarter]} START</strong>
          <span>
            {session.starterMode === 'loser'
              ? record.outcome === 'draw'
                ? '敗者先攻（引き分けのため先攻を交代）'
                : '敗者先攻'
              : '交互先攻'}
          </span>
        </div>
      )}

      <button type="button" className="primary-button" onClick={onNext}>
        {isLast ? '総合リザルトへ' : `次の種目へ・${getEngine(nextId).meta.name}`}
      </button>
      {canUndo && (
        <button type="button" className="text-button" onClick={onUndo}>
          戻る（直前の入力をやり直す）
        </button>
      )}
    </div>
  );
}
