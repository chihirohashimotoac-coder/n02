import { getEngine } from '../../domain/pentathlon/presets';
import { isSingleGameSession, sessionDisciplines } from '../../domain/pentathlon/session';
import type { PentathlonSession } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  /**
   * Renders the list inside a closed-by-default disclosure, so screens that need the input pad in
   * the first viewport (Cricket) can keep the standings reachable without spending the height.
   */
  collapsible?: boolean;
}

export default function PentathlonProgress({ session, collapsible = false }: Props) {
  // 個別練習 plays exactly one discipline, so a 1-of-1 progress list says nothing.
  if (isSingleGameSession(session)) return null;

  const disciplines = sessionDisciplines(session);
  const presetName = session.preset === 'jda' ? 'JDA PENTATHLON' : 'n01 / i-PENTATHLON';
  const position = `${Math.min(session.currentDisciplineIndex + 1, disciplines.length)} / ${disciplines.length}`;

  const list = (
    <ol className="pent-progress-list">
      {disciplines.map((id, index) => {
        const record = session.records[index];
        const isDone = Boolean(record);
        const isPlaying = index === session.currentDisciplineIndex && session.status !== 'completed';
        const engine = getEngine(id);
        return (
          <li
            key={id}
            className={`pent-progress-item ${isDone ? 'done' : ''} ${isPlaying ? 'playing' : ''}`}
            aria-current={isPlaying ? 'step' : undefined}
          >
            <i className="pent-state" aria-hidden="true">
              {isDone ? '✓' : isPlaying ? '▶' : '·'}
            </i>
            <span>{engine.meta.name}</span>
            <span className="pent-score">
              {record
                ? session.playerCount === 2
                  ? `${record.results[0]?.label ?? '—'} / ${record.results[1]?.label ?? '—'}`
                  : (record.results[0]?.label ?? '—')
                : isPlaying
                  ? 'PLAYING'
                  : ''}
            </span>
            <span className="sr-only">{isDone ? '完了' : isPlaying ? 'プレイ中' : '未プレイ'}</span>
          </li>
        );
      })}
    </ol>
  );

  if (collapsible) {
    return (
      <details className="pent-progress pent-progress-collapsible">
        <summary className="pent-progress-head">
          <strong>{presetName}</strong>
          <span>{position}</span>
        </summary>
        {list}
      </details>
    );
  }

  return (
    <div className="pent-progress">
      <div className="pent-progress-head">
        <strong>{presetName}</strong>
        <span>{position}</span>
      </div>
      {list}
    </div>
  );
}
