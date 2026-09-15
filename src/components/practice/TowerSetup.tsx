import { useState } from 'react';
import {
  TOWER_RULES,
  floorTargetText,
  type TowerSettings,
} from '../../domain/practice/tower';
import { loadTowerHistory, type TowerHistoryEntry } from '../../storage/towerStorage';

interface Props {
  settings: TowerSettings;
  onChangeSettings: (settings: TowerSettings) => void;
  onStart: (settings: TowerSettings) => void;
  onBack: () => void;
}

function outcomeLabel(entry: TowerHistoryEntry['players'][number]): string {
  if (entry.status === 'cleared') return 'GAME CLEAR';
  return `${entry.clearFloor}F まで`;
}

export default function TowerSetup({ settings, onChangeSettings, onStart, onBack }: Props) {
  const [history] = useState<TowerHistoryEntry[]>(loadTowerHistory);

  const update = (patch: Partial<TowerSettings>) => onChangeSettings({ ...settings, ...patch });
  const playerIndexes = settings.playerCount === 2 ? ([0, 1] as const) : ([0] as const);

  return (
    <div className="panel setup-panel tower-setup">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PRACTICE / TOWER</p>
          <h1>TOWER OF THE DARTS 設定</h1>
        </div>
        <span className="status-chip">{TOWER_RULES.finalFloor} FLOORS</span>
      </div>

      <p className="practice-note">
        1F から {TOWER_RULES.finalFloor}F まで、各階のお題を1投ずつ突破していく登頂モードです。ハードダーツ用に、
        <strong>着弾を見た人が「成功」か「MISS」を押す</strong>方式で進めます。アプリが着弾を判定することはありません。
      </p>

      <div className="field-section">
        <h2 id="tower-player-count">プレイ人数</h2>
        <div className="countup-choice-grid" role="group" aria-labelledby="tower-player-count">
          {([1, 2] as const).map((count) => (
            <button
              key={count}
              type="button"
              className={`countup-choice ${settings.playerCount === count ? 'selected' : ''}`}
              aria-pressed={settings.playerCount === count}
              onClick={() => update({ playerCount: count })}
            >
              <strong>
                {count} PLAYER{count === 2 ? 'S' : ''}
              </strong>
              <small>{count === 1 ? '自分のペースで登頂' : '同じ端末で交代プレイ'}</small>
            </button>
          ))}
        </div>
        {settings.playerCount === 2 && (
          <p className="practice-note small">
            2人とも 1F から自分の塔を登ります。階・LIFE・CONTINUE はプレイヤーごとに別々です。
            投げていない側が着弾を確認して入力すると進行がスムーズです。
          </p>
        )}
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

      <div className="field-section">
        <h2>ルール</h2>
        <ul className="tower-rule-list">
          <li>
            <b>START LIFE {TOWER_RULES.startLife}</b>
            <span>MISS で LIFE −1。同じ階・同じお題のまま再挑戦します。</span>
          </li>
          <li>
            <b>CONTINUE {TOWER_RULES.continues}</b>
            <span>LIFE 0 で GAME OVER。枠が残っていれば同じ階・LIFE {TOWER_RULES.startLife} で再開できます。</span>
          </li>
          <li>
            <b>RECOVERY ON</b>
            <span>
              {TOWER_RULES.recoveryInterval}の倍数階を<strong>突破した時</strong>に LIFE が {TOWER_RULES.maxLife} へ戻ります（
              {TOWER_RULES.recoveryInterval}F に上がっただけでは回復しません）。
            </span>
          </li>
          <li>
            <b>1手番 {TOWER_RULES.dartsPerTurn} DARTS</b>
            <span>階をまたいで数えます。{TOWER_RULES.dartsPerTurn}投したらダーツを回収してから次の手番へ。</span>
          </li>
          <li>
            <b>{TOWER_RULES.finalFloor}F</b>
            <span>
              到達だけではクリアになりません。{TOWER_RULES.finalFloor}F のお題（{floorTargetText(TOWER_RULES.finalFloor)}
              ）を成功させると GAME CLEAR です。
            </span>
          </li>
        </ul>
        <p className="practice-note small tower-close-call-note">
          <b>際どい着弾のとき</b>は、成功・MISS のどちらも押さずに盤面を確認してください。入力があるまで階も LIFE も投数も動きません。
        </p>
      </div>

      <button type="button" className="primary-button countup-start" onClick={() => onStart(settings)}>
        ➤ TOWER を開始
      </button>
      <button type="button" className="text-button" onClick={onBack}>
        PRACTICE へ戻る
      </button>

      <div className="field-section">
        <h2>RECENT RESULTS</h2>
        {history.length === 0 ? (
          <p className="practice-note small">
            まだ記録がありません。TOWER を終了すると最新10件まで保存されます。
          </p>
        ) : (
          <ol className="countup-history">
            {history.map((entry, index) => (
              <li key={`${entry.date}-${index}`}>
                <div className="countup-history-head">
                  <span>{formatDate(entry.date)}</span>
                  <span>
                    LIFE {entry.rules.startLife} / CONTINUE {entry.rules.continues}
                  </span>
                </div>
                {entry.players.map((player, playerIndex) => (
                  <div className="countup-history-row" key={playerIndex}>
                    <strong>{player.name}</strong>
                    <b>{player.clearFloor}</b>
                    <span>CLEAR FLOOR</span>
                    <small>
                      {outcomeLabel(player)}／{player.throws}投・CONTINUE {player.continuesUsed}
                    </small>
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
