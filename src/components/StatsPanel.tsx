import { useMemo } from 'react';
import { clearHistory, HISTORY_LIMIT, type HistoryEntry } from '../storage/matchStorage';

interface Props {
  history: HistoryEntry[];
  onReset: () => void;
}

/**
 * How many recent checkouts the 平均ダーツ figure averages over. Only that one number uses a
 * window; every other figure on this panel is computed from the whole stored history.
 */
const AVERAGE_WINDOW = 10;

export default function StatsPanel({ history, onReset }: Props) {
  const stats = useMemo(() => {
    const checkouts = history.filter((entry) => entry.reason === 'checkout');
    const recent = checkouts.slice(0, AVERAGE_WINDOW);
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
        <span>保存分 最大{HISTORY_LIMIT} Leg</span>
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
          <span>保存されている全記録の合計</span>
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
          <span>直近{AVERAGE_WINDOW}回のチェックアウトの平均</span>
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
