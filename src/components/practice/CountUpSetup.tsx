import { useState } from 'react';
import {
  AWARD_LABELS,
  COUNT_UP_ROUNDS,
  formatPpr,
  type AwardKind,
  type BullMode,
  type CountUpSettings,
} from '../../domain/practice/countUp';
import { loadCountUpHistory, type CountUpHistoryEntry } from '../../storage/practiceStorage';

interface Props {
  settings: CountUpSettings;
  onChangeSettings: (settings: CountUpSettings) => void;
  onStart: (settings: CountUpSettings) => void;
  onBack: () => void;
}

const BULL_MODES: Array<{ value: BullMode; label: string; note: string }> = [
  { value: 'separate', label: 'SEPARATE BULL', note: 'インブル50・アウターブル25。150は THREE IN THE BLACK。' },
  { value: 'fat', label: 'FAT BULL', note: 'ブルは一律50。150は HAT TRICK。' },
];

/** Award counts worth putting on a history row - a game with none of them shows nothing. */
function historyAwards(awards: Record<AwardKind, number>): string[] {
  return (Object.keys(awards) as AwardKind[])
    .filter((kind) => awards[kind] > 0)
    .map((kind) => `${AWARD_LABELS[kind]} ×${awards[kind]}`);
}

export default function CountUpSetup({ settings, onChangeSettings, onStart, onBack }: Props) {
  const [history] = useState<CountUpHistoryEntry[]>(loadCountUpHistory);

  const update = (patch: Partial<CountUpSettings>) => onChangeSettings({ ...settings, ...patch });

  const playerIndexes = settings.playerCount === 2 ? ([0, 1] as const) : ([0] as const);

  return (
    <div className="panel setup-panel countup-setup">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PRACTICE / COUNT-UP</p>
          <h1>COUNT-UP 設定</h1>
        </div>
        <span className="status-chip">{COUNT_UP_ROUNDS} ROUNDS</span>
      </div>

      <p className="practice-note">
        1ラウンド3ダーツ、全{COUNT_UP_ROUNDS}ラウンド（最大24ダーツ）。ラウンドごとの合計得点を入力して総得点を競います。
        バーストやダブルアウトはありません。
      </p>

      <div className="field-section">
        <h2 id="countup-player-count">プレイ人数</h2>
        <div className="countup-choice-grid" role="group" aria-labelledby="countup-player-count">
          {([1, 2] as const).map((count) => (
            <button
              key={count}
              type="button"
              className={`countup-choice ${settings.playerCount === count ? 'selected' : ''}`}
              aria-pressed={settings.playerCount === count}
              onClick={() => update({ playerCount: count })}
            >
              <strong>{count} PLAYER{count === 2 ? 'S' : ''}</strong>
              <small>{count === 1 ? '自己ベスト更新' : 'TOTALで勝敗'}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="field-section">
        <h2 id="countup-bull-mode">BULL 設定</h2>
        <div className="countup-choice-grid" role="group" aria-labelledby="countup-bull-mode">
          {BULL_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={`countup-choice ${settings.bullMode === mode.value ? 'selected' : ''}`}
              aria-pressed={settings.bullMode === mode.value}
              onClick={() => update({ bullMode: mode.value })}
            >
              <strong>{mode.label}</strong>
              <small>{mode.note}</small>
            </button>
          ))}
        </div>
        <p className="practice-note small">
          ラウンド合計を入力する方式のため、BULL設定は通常の得点計算には影響しません。150点のアワード判定にのみ使用します。
        </p>
      </div>

      <div className="field-section">
        <h2>プレイヤー名</h2>
        <div className="players-setup">
          {playerIndexes.map((index) => (
            <div className="player-config" key={index}>
              <label className="field">
                <span>プレイヤー {index + 1}</span>
                <div className="name-input">
                  <i aria-hidden="true">●</i>
                  <input
                    maxLength={18}
                    value={settings.names[index]}
                    placeholder={`PLAYER ${index + 1}`}
                    aria-label={`プレイヤー${index + 1}の名前`}
                    onChange={(event) => {
                      const names: [string, string] = [...settings.names];
                      names[index] = event.target.value;
                      update({ names });
                    }}
                  />
                </div>
                <small>未入力なら PLAYER {index + 1} になります。</small>
              </label>
            </div>
          ))}
        </div>
      </div>

      <button type="button" className="primary-button countup-start" onClick={() => onStart(settings)}>
        ➤ COUNT-UP を開始
      </button>
      <button type="button" className="text-button" onClick={onBack}>
        PRACTICE へ戻る
      </button>

      <div className="field-section">
        <h2>RECENT RESULTS</h2>
        {history.length === 0 ? (
          <p className="practice-note small">まだ記録がありません。COUNT-UPを完走すると最新10件まで保存されます。</p>
        ) : (
          <ol className="countup-history">
            {history.map((entry, index) => (
              <li key={`${entry.date}-${index}`}>
                <div className="countup-history-head">
                  <span>{formatDate(entry.date)}</span>
                  <span>{entry.bullMode === 'fat' ? 'FAT BULL' : 'SEPARATE BULL'}</span>
                </div>
                {entry.players.map((player, playerIndex) => (
                  <div className="countup-history-row" key={playerIndex}>
                    <strong>{player.name}</strong>
                    <b>{player.total}</b>
                    <span>PPR {formatPpr(player.ppr)}</span>
                    <small>{historyAwards(player.awards).join(' / ') || '—'}</small>
                  </div>
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
