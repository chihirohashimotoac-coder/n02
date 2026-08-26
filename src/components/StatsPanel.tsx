import { useMemo } from 'react';
import { clearHistory, type HistoryEntry } from '../storage/matchStorage';

interface Props {
  history: HistoryEntry[];
  onReset: () => void;
}

export default function StatsPanel({ history, onReset }: Props) {
  const stats = useMemo(() => {
    const checkouts = history.filter((entry) => entry.reason === 'checkout');
    const recent = checkouts.slice(0, 10);
    const averageDarts =
      recent.length > 0 ? recent.reduce((sum, entry) => sum + entry.darts, 0) / recent.length : null;
    const bestDarts = checkouts.length > 0 ? Math.min(...checkouts.map((entry) => entry.darts)) : null;
    const uniqueTargets = new Set(checkouts.map((entry) => entry.startScore)).size;
    return {
      completed: checkouts.length,
      averageDarts,
      bestDarts,
      totalLegs: history.length,
      uniqueTargets,
    };
  }, [history]);

  const handleReset = () => {
    const confirmed = window.confirm('この端末に保存された直近の成績をすべて削除します。よろしいですか？');
    if (!confirmed) return;
    clearHistory();
    onReset();
  };

  return (
    <aside className="stats-panel panel">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">RECENT FORM</p>
          <h2>直近の成績</h2>
        </div>
        <span>直近10 Leg</span>
      </div>

      <article className="metric-card">
        <span className="metric-icon" aria-hidden="true">
          ◎
        </span>
        <div>
          <p>完了したチェックアウト</p>
          <strong>
            {stats.completed}
            <small>Leg</small>
          </strong>
          <span>この端末に保存された直近の記録</span>
        </div>
      </article>

      <article className="metric-card">
        <span className="metric-icon" aria-hidden="true">
          ▥
        </span>
        <div>
          <p>平均ダーツ</p>
          <strong>
            {stats.averageDarts !== null ? stats.averageDarts.toFixed(1) : '—'}
            <small>本</small>
          </strong>
          <span>チェックアウト完了までに使用</span>
        </div>
      </article>

      <div className="stat-strip">
        <div>
          <strong>{stats.bestDarts ?? '—'}</strong>
          <span>ベストダーツ</span>
        </div>
        <div>
          <strong>{stats.totalLegs}</strong>
          <span>総記録Leg</span>
        </div>
        <div>
          <strong>{stats.uniqueTargets}</strong>
          <span>攻略した数字</span>
        </div>
      </div>

      <div className="privacy-note">
        <span aria-hidden="true">✓</span>
        <p>
          <strong>データは端末内だけに保存</strong>
          <br />
          アカウント登録なしで、オフラインでも利用できます。
        </p>
      </div>

      <button type="button" className="subtle-button reset-stats" onClick={handleReset}>
        直近の成績をリセット
      </button>
      <p className="credit-note">© 2026 Chihiro Hashimoto</p>
    </aside>
  );
}
