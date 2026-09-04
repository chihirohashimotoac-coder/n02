interface Props {
  onSelectCountUp: () => void;
  onExit: () => void;
}

/**
 * The PRACTICE hub. Its own level between the top menu and a drill, so adding a discipline later is
 * one entry in COMING_SOON / one more playable card - the top menu never has to be redesigned.
 */
const COMING_SOON = [
  {
    id: 'cricket-count-up',
    title: 'CRICKET COUNT-UP',
    subtitle: '15-20 / BULL SCORING',
    note: 'クリケットナンバーだけを狙って得点を積み上げる練習。',
  },
  {
    id: 'eagles-eye',
    title: "EAGLE'S EYE",
    subtitle: 'BULL ACCURACY',
    note: 'ブル一点集中。狙いの精度を測る練習。',
  },
] as const;

export default function PracticeHub({ onSelectCountUp, onExit }: Props) {
  return (
    <div className="panel setup-panel practice-hub">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PRACTICE</p>
          <h1>練習メニュー</h1>
        </div>
        <span className="status-chip">1人・2人対応</span>
      </div>

      <p className="practice-note">
        ダーツの基礎練習をまとめたメニューです。今回プレイできるのは COUNT-UP です。
      </p>

      <div className="practice-card-grid">
        <button type="button" className="practice-card playable" data-practice="count-up" onClick={onSelectCountUp}>
          <span className="practice-card-badge">PLAYABLE</span>
          <strong>COUNT-UP</strong>
          <span className="practice-card-sub">8 ROUNDS / TOTAL SCORE</span>
          <small>8ラウンド24ダーツで合計得点を競う、最も基本的なスコア練習。</small>
          <span className="practice-card-go" aria-hidden="true">
            ➤
          </span>
        </button>

        {COMING_SOON.map((item) => (
          <div key={item.id} className="practice-card coming-soon" data-practice={item.id} aria-disabled="true">
            <span className="practice-card-badge">COMING SOON</span>
            <strong>{item.title}</strong>
            <span className="practice-card-sub">{item.subtitle}</span>
            <small>{item.note}</small>
            <span className="practice-card-lock">準備中</span>
          </div>
        ))}
      </div>

      <button type="button" className="text-button" onClick={onExit}>
        メニューへ戻る
      </button>
    </div>
  );
}
