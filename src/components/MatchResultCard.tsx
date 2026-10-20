import { useMemo, useRef } from 'react';
import type { X01MatchState } from '../domain/x01Engine';
import { selectX01Stats, type X01PlayerStatsDisplay } from '../domain/x01Stats';
import { shareNodeAsImage } from '../share/shareCard';

interface Props {
  state: X01MatchState;
  onNewMatch: () => void;
  onBackToMenu: () => void;
}

export default function MatchResultCard({ state, onNewMatch, onBackToMenu }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const winner = state.matchWinner;
  // The same selector as the play screen, so 3DA, LEGS, 100+, 140+, 180 and HIGH OUT here are the
  // figures the player was just looking at. DARTS is the darts actually thrown, from the engine.
  const stats = useMemo(() => selectX01Stats(state, 'basic'), [state]);
  const figure = (read: (player: X01PlayerStatsDisplay) => string | number): [string, string] =>
    stats.ok ? [String(read(stats.players[0])), String(read(stats.players[1]))] : ['—', '—'];

  return (
    <div className="result-backdrop" role="dialog" aria-modal="true" aria-label="マッチ結果">
      <div className="result-card match-summary" ref={cardRef}>
        <div className="result-icon" aria-hidden="true">
          ✓
        </div>
        <p>MATCH WINNER</p>
        <h2>{winner === null ? '引き分け' : state.players[winner].name}</h2>
        <div className="match-legs-score">
          {state.players[0].legs} - {state.players[1].legs}
        </div>

        <div className="match-stats-block">
          <div className="n01-stats-head">
            <strong>{state.players[0].name}</strong>
            <span>TOTAL</span>
            <strong>{state.players[1].name}</strong>
          </div>
          <Row label="3DA" values={figure((p) => p.average)} />
          <Row label="LEGS" values={figure((p) => p.legs)} />
          <Row label="DARTS" values={[String(state.players[0].totalDarts), String(state.players[1].totalDarts)]} />
          <Row label="100+" values={figure((p) => p.ton00)} />
          <Row label="140+" values={figure((p) => p.ton40)} />
          <Row label="180" values={figure((p) => p.ton80)} />
          <Row label="HIGH OUT" values={figure((p) => p.highFinish)} />
        </div>

        {state.completed.length > 0 && (
          <>
            <div className="leg-stats-title">LEG BY LEG</div>
            <div className="leg-stats-scroll">
              <table className="leg-stats-table">
                <thead>
                  <tr>
                    <th>LEG</th>
                    <th>開始点</th>
                    <th>勝者</th>
                    <th>上がり</th>
                  </tr>
                </thead>
                <tbody>
                  {state.completed.map((leg, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>{leg.startScore}</td>
                      <td className="leg-winner">
                        {leg.winner === null ? '引き分け' : state.players[leg.winner].name}
                      </td>
                      <td>{leg.darts || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <button
          type="button"
          className="secondary-button share-card"
          onClick={() => {
            if (cardRef.current) void shareNodeAsImage(cardRef.current, 'n02-result.png');
          }}
        >
          リザルトカードを共有
        </button>
        <button type="button" className="primary-button" onClick={onNewMatch}>
          新しい対戦を始める <kbd>Enter</kbd>
        </button>
        <button type="button" className="text-button" onClick={onBackToMenu}>
          メニューへ戻る
        </button>
      </div>
    </div>
  );
}

function Row({ label, values }: { label: string; values: [string, string] }) {
  return (
    <div className="n01-stats-row">
      <strong>{values[0]}</strong>
      <span>{label}</span>
      <strong>{values[1]}</strong>
    </div>
  );
}
