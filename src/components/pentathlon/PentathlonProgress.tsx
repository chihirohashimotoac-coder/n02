import { getEngine, presetDisciplines } from '../../domain/pentathlon/presets';
import type { PentathlonSession } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
}

export default function PentathlonProgress({ session }: Props) {
  const disciplines = presetDisciplines(session.preset);
  const presetName = session.preset === 'jda' ? 'JDA PENTATHLON' : 'n01 / i-PENTATHLON';

  return (
    <div className="pent-progress">
      <div className="pent-progress-head">
        <strong>{presetName}</strong>
        <span>
          {Math.min(session.currentDisciplineIndex + 1, disciplines.length)} / {disciplines.length}
        </span>
      </div>
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
              <span className="sr-only">
                {isDone ? '完了' : isPlaying ? 'プレイ中' : '未プレイ'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
