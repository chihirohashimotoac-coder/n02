import { useState } from 'react';
import { PRESETS, getEngine } from '../../domain/pentathlon/presets';
import PentathlonRulesModal from './PentathlonRulesModal';
import type { PentathlonPreset, PlayerIndex, StarterMode } from '../../domain/pentathlon/types';
import type { CreateSessionOptions } from '../../domain/pentathlon/session';

interface Props {
  onStart: (options: CreateSessionOptions) => void;
  onCancel: () => void;
  hasSavedSession: boolean;
  onResume: () => void;
}

export default function PentathlonSetup({ onStart, onCancel, hasSavedSession, onResume }: Props) {
  const [preset, setPreset] = useState<PentathlonPreset>('jda');
  const [playerCount, setPlayerCount] = useState<1 | 2>(2);
  const [names, setNames] = useState<[string, string]>(['プレイヤー1', 'プレイヤー2']);
  const [initialStarter, setInitialStarter] = useState<PlayerIndex | 'random'>(0);
  const [starterMode, setStarterMode] = useState<StarterMode>('loser');
  const [showRoute, setShowRoute] = useState(false);

  return (
    <div className="panel setup-panel pent-setup">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PENTATHLON</p>
          <h1>ペンタスロン設定</h1>
        </div>
        <span className="status-chip">5種目総合競技</span>
      </div>

      {hasSavedSession && (
        <button type="button" className="resume-button" onClick={onResume}>
          中断したペンタスロンを再開 <span>途中の種目から続行</span>
        </button>
      )}

      <div className="field-section">
        <h2 id="pent-preset-heading">ルールセット</h2>
        <div className="pent-preset-grid" role="group" aria-labelledby="pent-preset-heading">
          {(Object.keys(PRESETS) as PentathlonPreset[]).map((key) => {
            const definition = PRESETS[key];
            return (
              <button
                key={key}
                type="button"
                className={`pent-preset-card ${preset === key ? 'selected' : ''}`}
                aria-pressed={preset === key}
                onClick={() => setPreset(key)}
              >
                <strong>{definition.name}</strong>
                <em>{definition.subtitle}</em>
                <ol>
                  {definition.disciplines.map((id) => (
                    <li key={id}>{getEngine(id).meta.name}</li>
                  ))}
                </ol>
                {preset === key && (
                  <b className="checkmark" aria-hidden="true">
                    ✓
                  </b>
                )}
              </button>
            );
          })}
        </div>
        <PentathlonRulesModal className="secondary-button" label="採用ルール・出典" />
      </div>

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

      {playerCount === 2 && (
        <div className="field-section">
          <h2>先攻設定</h2>
          <div className="settings-grid">
            <label className="field">
              <span>第1種目の先攻</span>
              <select
                value={String(initialStarter)}
                onChange={(event) => {
                  const value = event.target.value;
                  setInitialStarter(value === 'random' ? 'random' : (Number(value) as PlayerIndex));
                }}
              >
                <option value="0">{names[0] || 'プレイヤー1'}</option>
                <option value="1">{names[1] || 'プレイヤー2'}</option>
                <option value="random">ランダム</option>
              </select>
              <small>ランダムは開始時に1度だけ決定し、再開時に引き直しません</small>
            </label>

            <label className="field">
              <span>次種目の先攻方式</span>
              <select
                value={starterMode}
                onChange={(event) => setStarterMode(event.target.value as StarterMode)}
              >
                <option value="loser">敗者先攻</option>
                <option value="alternate">交互先攻</option>
              </select>
              <small>
                {starterMode === 'loser'
                  ? '前種目の敗者が次種目の先攻。引き分けなら前種目の後攻が先攻'
                  : '勝敗に関係なく種目ごとに先攻を交代'}
              </small>
            </label>
          </div>
        </div>
      )}

      <button
        type="button"
        className="primary-button"
        onClick={() => onStart({ preset, playerCount, names, starterMode, initialStarter, showRoute })}
      >
        ➤ ペンタスロンを開始
      </button>
      <button type="button" className="text-button" onClick={onCancel}>
        メニューへ戻る
      </button>
    </div>
  );
}
