import { useRef } from 'react';
import { threeDartAverage, type X01MatchState } from '../domain/x01Engine';
import { shareNodeAsImage } from '../share/shareCard';

interface Props {
  state: X01MatchState;
  onNewMatch: () => void;
  onBackToMenu: () => void;
}

export default function MatchResultCard({ state, onNewMatch, onBackToMenu }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const winner = state.matchWinner;

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
          <Row label="3DA" values={[threeDartAverage(state.players[0]).toFixed(2), threeDartAverage(state.players[1]).toFixed(2)]} />
          <Row label="LEGS" values={[String(state.players[0].legs), String(state.players[1].legs)]} />
          <Row label="DARTS" values={[String(state.players[0].totalDarts), String(state.players[1].totalDarts)]} />
          <Row label="100+" values={[String(state.players[0].ton00Count), String(state.players[1].ton00Count)]} />
          <Row label="140+" values={[String(state.players[0].ton40Count), String(state.players[1].ton40Count)]} />
          <Row label="180" values={[String(state.players[0].ton80Count), String(state.players[1].ton80Count)]} />
          <Row
            label="HIGH OUT"
            values={[
              String(state.players[0].highestFinish || '—'),
              String(state.players[1].highestFinish || '—'),
            ]}
          />
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
          新しい対戦を始める
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
