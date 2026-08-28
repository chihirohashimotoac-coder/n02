import { useState } from 'react';
import { PRESETS, SINGLE_GAME_OPTIONS } from '../../domain/pentathlon/presets';
import PentathlonRulesModal from './PentathlonRulesModal';
import type { PentathlonPreset } from '../../domain/pentathlon/types';
import type { CreateSessionOptions } from '../../domain/pentathlon/session';

interface Props {
  onStart: (options: CreateSessionOptions) => void;
  onCancel: () => void;
  /** Pre-selects a discipline, e.g. when coming back from a finished single game. */
  initialKey?: string;
  /** True when 「中断してメニューへ」 left a single game part-way through. */
  hasSavedSession: boolean;
  onResume: () => void;
  /** Label of the interrupted game, so the resume button says what it will pick back up. */
  savedLabel?: string;
}

/**
 * 個別練習 setup: pick one discipline out of either preset and play just that one. Kept separate
 * from PentathlonSetup because none of the pentathlon-wide options (starter rotation between
 * disciplines, overall standing) mean anything for a single game.
 */
export default function SingleGameSetup({
  onStart,
  onCancel,
  initialKey,
  hasSavedSession,
  onResume,
  savedLabel,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string>(initialKey ?? SINGLE_GAME_OPTIONS[0].key);
  const [playerCount, setPlayerCount] = useState<1 | 2>(2);
  const [names, setNames] = useState<[string, string]>(['プレイヤー1', 'プレイヤー2']);
  const [showRoute, setShowRoute] = useState(false);

  const selected =
    SINGLE_GAME_OPTIONS.find((option) => option.key === selectedKey) ?? SINGLE_GAME_OPTIONS[0];

  return (
    <div className="panel setup-panel pent-setup">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PENTATHLON</p>
          <h1>ペンタスロン個別練習</h1>
        </div>
        <span className="status-chip">1種目のみ</span>
      </div>

      <p className="pent-note">
        ペンタスロンの各種目を1つだけ選んでプレイします。総合成績は付かず、進行中のペンタスロンにも影響しません。
      </p>

      {hasSavedSession && (
        <button type="button" className="resume-button" onClick={onResume}>
          中断した個別練習を再開
          <span>{savedLabel ? `${savedLabel}・途中から続行` : '途中から続行'}</span>
        </button>
      )}

      {(Object.keys(PRESETS) as PentathlonPreset[]).map((preset) => (
        <div className="field-section" key={preset}>
          <h2 id={`single-${preset}-heading`}>{PRESETS[preset].name}</h2>
          <div className="pent-single-grid" role="group" aria-labelledby={`single-${preset}-heading`}>
            {SINGLE_GAME_OPTIONS.filter((option) => option.preset === preset).map((option) => (
              <button
                key={option.key}
                type="button"
                className={`pent-single-card ${selectedKey === option.key ? 'selected' : ''}`}
                aria-pressed={selectedKey === option.key}
                onClick={() => setSelectedKey(option.key)}
              >
                <strong>{option.label}</strong>
                <small>{option.description}</small>
                {selectedKey === option.key && (
                  <b className="checkmark" aria-hidden="true">
                    ✓
                  </b>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="field-section">
        <h2>プレイ人数</h2>
        <div className="settings-grid">
          <label className="field">
            <span>人数</span>
            <select
              value={playerCount}
              onChange={(event) => setPlayerCount(Number(event.target.value) as 1 | 2)}
            >
              <option value={1}>1人（自己記録）</option>
              <option value={2}>2人（対戦）</option>
            </select>
          </label>

          <label className="toggle-field">
            <span>
              <strong>アレンジルート</strong>
              <small>501/301プレイ中にチェックアウトルートの参考表示（デフォルトOFF）</small>
            </span>
            <input
              type="checkbox"
              checked={showRoute}
              onChange={(event) => setShowRoute(event.target.checked)}
            />
          </label>
        </div>
      </div>

      <div className="field-section">
        <h2>プレイヤー設定</h2>
        <div className="players-setup">
          {(playerCount === 1 ? ([0] as const) : ([0, 1] as const)).map((index) => (
            <div className="player-config" key={index}>
              <label className="field">
                <span>プレイヤー {index + 1}</span>
                <div className="name-input">
                  <i aria-hidden="true">●</i>
                  <input
                    maxLength={18}
                    value={names[index]}
                    aria-label={`プレイヤー${index + 1}の名前`}
                    onChange={(event) => {
                      const next: [string, string] = [...names];
                      next[index] = event.target.value;
                      setNames(next);
                    }}
                  />
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>

      <PentathlonRulesModal className="secondary-button" label="採用ルール・出典" />

      <button
        type="button"
        className="primary-button"
        onClick={() =>
          onStart({
            preset: selected.preset,
            mode: 'single',
            disciplines: [selected.disciplineId],
            playerCount,
            names,
            starterMode: 'alternate',
            initialStarter: 0,
            showRoute,
          })
        }
      >
        ➤ {selected.label} を開始
      </button>
      <button type="button" className="text-button" onClick={onCancel}>
        メニューへ戻る
      </button>
    </div>
  );
}
