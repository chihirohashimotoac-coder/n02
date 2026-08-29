import { useRef } from 'react';
import { getEngine } from '../../domain/pentathlon/presets';
import { computeTotals } from '../../domain/pentathlon/session';
import { shareNodeAsImage } from '../../share/shareCard';
import PentathlonRulesModal from './PentathlonRulesModal';
import type { PentathlonSession } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onFinish: () => void;
}

export default function PentathlonResult({ session, onFinish }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const totals = computeTotals(session);
  const presetName = session.preset === 'jda' ? 'JDA' : 'n01 / i-Pentathlon';
  const date = new Date(session.startedAt).toLocaleDateString('ja-JP');

  return (
    <div className="pent-game-shell">
    <div className="pent-play">
      <div className="result-card pent-share-card" ref={cardRef} style={{ width: '100%' }}>
        <div className="pent-share-head">
          <b>PENTATHLON</b>
          <span>
            {presetName}・{date}
          </span>
        </div>

        <div className="pent-result-table">
          <div className="pent-result-row head">
            <span className="name">DISCIPLINE</span>
            <span>{session.names[0]}</span>
            {session.playerCount === 2 && <span>{session.names[1]}</span>}
          </div>
          {session.records.map((record) => {
            const engine = getEngine(record.id);
            return (
              <div className="pent-result-row" key={record.id}>
                <span className="name">{engine.meta.name}</span>
                <span className={`value ${record.outcome === 'p0' ? 'win' : ''}`}>
                  {record.outcome === 'p0' && (
                    <i className="pent-win-mark" aria-hidden="true">
                      ★
                    </i>
                  )}
                  {record.results[0]?.label ?? '—'}
                </span>
                {session.playerCount === 2 && (
                  <span className={`value ${record.outcome === 'p1' ? 'win' : ''}`}>
                    {record.outcome === 'p1' && (
                      <i className="pent-win-mark" aria-hidden="true">
                        ★
                      </i>
                    )}
                    {record.results[1]?.label ?? '—'}
                  </span>
                )}
              </div>
            );
          })}
          {session.playerCount === 2 && (
            <div className="pent-result-row total">
              <span className="name">種目勝利数</span>
              <span className={`value ${totals.overall === 'p0' ? 'win' : ''}`}>{totals.wins[0]}</span>
              <span className={`value ${totals.overall === 'p1' ? 'win' : ''}`}>{totals.wins[1]}</span>
            </div>
          )}
        </div>

        {session.playerCount === 2 && (
          <div
            className={`pent-next-starter pent-winner-banner ${totals.overall === 'draw' ? 'draw' : ''}`}
          >
            <span>WINNER</span>
            <strong>
              {totals.overall === 'draw'
                ? '引き分け'
                : totals.overall === 'p0'
                  ? session.names[0]
                  : session.names[1]}
            </strong>
          </div>
        )}
      </div>

      <p className="pent-note">
        {session.playerCount === 1
          ? '各種目の結果記録です。'
          : '総合順位は勝利種目数で決定します。勝利種目数が同じ場合は総合引き分けです。'}
      </p>

      <PentathlonRulesModal className="secondary-button" label="採用ルール・出典" />

      <button
        type="button"
        className="secondary-button share-card"
        onClick={() => {
          if (cardRef.current) void shareNodeAsImage(cardRef.current, 'n02-pentathlon-result.png');
        }}
      >
        リザルトカードを共有
      </button>
      <button type="button" className="primary-button" onClick={onFinish}>
        メニューへ戻る
      </button>
    </div>
    </div>
  );
}
