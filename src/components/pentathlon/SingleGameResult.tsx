import { getEngine, PRESETS } from '../../domain/pentathlon/presets';
import DisciplineResultTable from './DisciplineResultTable';
import PentathlonRulesButton from './PentathlonRulesButton';
import { DISCIPLINE_RULE_TEXT } from '../../domain/pentathlon/ruleText';
import type { PentathlonSession } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onPlayAgain: () => void;
  onChooseAnother: () => void;
  onExit: () => void;
}

/**
 * Result screen for 個別練習: one discipline, judged on its own. No overall standing, no discipline
 * win count, and no path onward to another discipline - those belong to a full pentathlon.
 */
export default function SingleGameResult({ session, onPlayAgain, onChooseAnother, onExit }: Props) {
  const record = session.records[session.records.length - 1];
  if (!record) return null;

  const engine = getEngine(record.id);
  const isTwoPlayer = session.playerCount === 2;

  return (
    <div className="pent-game-shell">
      <div className="pent-play">
        <div className="section-heading">
          <div>
            <p className="eyebrow">GAME COMPLETE・{PRESETS[session.preset].shortName}</p>
            <h1>{engine.meta.name}</h1>
          </div>
        </div>

        <DisciplineResultTable
          session={session}
          results={record.results}
          winner={record.outcome === 'p0' ? 0 : record.outcome === 'p1' ? 1 : null}
        />

        {isTwoPlayer && (
          <div
            className={`pent-next-starter pent-winner-banner ${record.outcome === 'draw' ? 'draw' : ''}`}
          >
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

        <p className="pent-note">
          {isTwoPlayer
            ? 'この種目単体の結果です。ペンタスロンの総合成績には含まれません。'
            : 'この種目単体の結果記録です。'}
        </p>

        <PentathlonRulesButton
          className="secondary-button"
          label="ルール説明"
          {...DISCIPLINE_RULE_TEXT[record.id]}
        />
        <button type="button" className="primary-button" onClick={onPlayAgain}>
          もう一度プレイ
        </button>
        <button type="button" className="secondary-button" onClick={onChooseAnother}>
          別のゲームを選ぶ
        </button>
        <button type="button" className="text-button" onClick={onExit}>
          メインメニューへ戻る
        </button>
      </div>
    </div>
  );
}
