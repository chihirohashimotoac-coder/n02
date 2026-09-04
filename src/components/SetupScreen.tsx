import { useMemo, useState } from 'react';
import TopBar from './TopBar';
import ThemeSelect from './ThemeSelect';
import StatsPanel from './StatsPanel';
import { computeDefaultMaxRounds, type X01MatchState, type X01Settings } from '../domain/x01Engine';
import {
  defaultTargetLegs,
  loadHistory,
  type HistoryEntry,
  type ThemeName,
} from '../storage/matchStorage';

interface Props {
  settings: X01Settings;
  onChangeSettings: (settings: X01Settings) => void;
  onStart: (settings: X01Settings) => void;
  onResume?: () => void;
  savedMatch: X01MatchState | null;
  theme: ThemeName;
  onChangeTheme: (theme: ThemeName) => void;
  onStartPentathlon: () => void;
  onStartPentathlonSingle: () => void;
  onStartPractice: () => void;
  hasSavedPentathlon: boolean;
}

const START_SCORES = [501, 701, 901, 1101];
const TARGET_LEGS = [
  { value: 0, label: 'なし（Legを継続）' },
  { value: 1, label: '1 Leg先取' },
  { value: 2, label: '2 Leg先取' },
  { value: 3, label: '3 Leg先取' },
  { value: 5, label: '5 Leg先取' },
  { value: 7, label: '7 Leg先取' },
  { value: 10, label: '10 Leg先取' },
];

export default function SetupScreen({
  settings,
  onChangeSettings,
  onStart,
  onResume,
  savedMatch,
  theme,
  onChangeTheme,
  onStartPentathlon,
  onStartPentathlonSingle,
  onStartPractice,
  hasSavedPentathlon,
}: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [error, setError] = useState<string | null>(null);
  // 勝利条件 differs by mode (see defaultTargetLegs), so switching mode restores that mode's own
  // value rather than carrying the other mode's over. A value the user picked here is remembered
  // for the rest of the session, so switching back and forth never discards their choice.
  const [legsByMode, setLegsByMode] = useState<Record<X01Settings['mode'], number>>(() => ({
    '01': settings.mode === '01' ? settings.targetLegs : defaultTargetLegs('01'),
    checkout: settings.mode === 'checkout' ? settings.targetLegs : defaultTargetLegs('checkout'),
  }));

  const update = (patch: Partial<X01Settings>) => {
    onChangeSettings({ ...settings, ...patch });
    setError(null);
  };

  const changeMode = (mode: X01Settings['mode']) => {
    update({ mode, targetLegs: legsByMode[mode] });
  };

  const changeTargetLegs = (targetLegs: number) => {
    setLegsByMode((current) => ({ ...current, [settings.mode]: targetLegs }));
    update({ targetLegs });
  };

  const validate = (): string | null => {
    if (settings.mode === 'checkout') {
      const { checkoutMin, checkoutMax } = settings;
      if (checkoutMin < 41 || checkoutMax > 999 || checkoutMin > checkoutMax) {
        return 'チェックアウト範囲は41～999で、下限が上限を超えないように設定してください。';
      }
    }
    if (settings.roundLimit && (settings.maxRounds < 1 || settings.maxRounds > 60)) {
      return 'ラウンド数制限は1～60ラウンドで設定してください。';
    }
    for (const index of [0, 1] as const) {
      if (settings.handicapEnabled[index]) {
        const score = settings.handicapScores[index];
        if (score < 2 || score > 1101) return 'ハンディキャップの開始点数は2～1101で設定してください。';
      }
    }
    return null;
  };

  const handleStart = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    onStart(settings);
  };

  const savedLabel = useMemo(() => {
    if (!savedMatch) return null;
    const mode = savedMatch.settings.mode === '01' ? `${savedMatch.settings.startScore}` : 'CHECKOUT';
    return `${mode}・LEG ${savedMatch.leg}`;
  }, [savedMatch]);

  return (
    <div className="app-shell">
      <TopBar />
      <section className="setup-layout">
        <div className="panel setup-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PRACTICE &amp; MATCH</p>
              <h1>プレイ設定</h1>
            </div>
            <span className="status-chip">端末内に自動保存</span>
          </div>

          <div className="field-section">
            <h2 id="mode-select-heading">モード選択</h2>
            <div className="mode-grid pent-mode-grid" role="group" aria-labelledby="mode-select-heading">
              <button
                type="button"
                className={`mode-card ${settings.mode === '01' ? 'selected' : ''}`}
                aria-pressed={settings.mode === '01'}
                onClick={() => changeMode('01')}
              >
                <span className="mode-icon" aria-hidden="true">
                  01
                </span>
                <strong>通常01</strong>
                <small>501 / 701 / 901 / 1101</small>
                {settings.mode === '01' && (
                  <b className="checkmark" aria-hidden="true">
                    ✓
                  </b>
                )}
              </button>
              <button
                type="button"
                className={`mode-card ${settings.mode === 'checkout' ? 'selected' : ''}`}
                aria-pressed={settings.mode === 'checkout'}
                onClick={() => changeMode('checkout')}
              >
                <span className="mode-icon" aria-hidden="true">
                  ◎
                </span>
                <strong>チェックアウト練習</strong>
                <small>同じ課題を2人で攻略</small>
                {settings.mode === 'checkout' && (
                  <b className="checkmark" aria-hidden="true">
                    ✓
                  </b>
                )}
              </button>
              <button type="button" className="mode-card" data-mode="pentathlon" onClick={onStartPentathlon}>
                <span className="mode-icon" aria-hidden="true">
                  5
                </span>
                <strong>ペンタスロン</strong>
                <small>5種目総合競技</small>
                {hasSavedPentathlon && <b className="checkmark pent-resume-mark">▶</b>}
              </button>
              <button
                type="button"
                className="mode-card"
                data-mode="pentathlon-single"
                onClick={onStartPentathlonSingle}
              >
                <span className="mode-icon" aria-hidden="true">
                  ◇
                </span>
                <strong>ペンタスロン個別練習</strong>
                <small>10種目から1つを選んでプレイ</small>
              </button>
              <button type="button" className="mode-card" data-mode="practice" onClick={onStartPractice}>
                <span className="mode-icon" aria-hidden="true">
                  ▲
                </span>
                <strong>PRACTICE</strong>
                <small>COUNT-UP ほか練習メニュー</small>
              </button>
            </div>
            <p className="pent-note" style={{ marginTop: 10 }}>
              ペンタスロンは JDA / n01・i-Pentathlon から選べる独立モードです。個別練習では各種目を1つずつ試せます。PRACTICE
              では COUNT-UP などの基礎練習をプレイできます。
              {hasSavedPentathlon && ' 中断したセッションを再開できます。'}
            </p>
          </div>

          <button type="button" className="primary-button" onClick={handleStart}>
            ➤ ゲームを開始
          </button>
          {onResume && (
            <button type="button" className="resume-button" onClick={onResume}>
              保存した対戦を再開 <span>{savedLabel}</span>
            </button>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}

          <div className="field-section">
            <h2>ゲーム設定</h2>
            <div className="settings-grid">
              {settings.mode === '01' ? (
                <label className="field">
                  <span>開始点数</span>
                  <select
                    value={settings.startScore}
                    onChange={(event) => update({ startScore: Number(event.target.value) })}
                  >
                    {START_SCORES.map((score) => (
                      <option key={score} value={score}>
                        {score}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>出題下限</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={settings.checkoutMin}
                      onChange={(event) => update({ checkoutMin: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>出題上限</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={settings.checkoutMax}
                      onChange={(event) => update({ checkoutMax: Number(event.target.value) })}
                    />
                    <small>170を超える設定にも対応</small>
                  </label>
                </>
              )}

              <label className="field">
                <span>勝利条件</span>
                <select
                  value={settings.targetLegs}
                  onChange={(event) => changeTargetLegs(Number(event.target.value))}
                >
                  {TARGET_LEGS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="toggle-field">
                <span>
                  <strong>アレンジルート</strong>
                  <small>PDCで頻出するアレンジルートを参照</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.showRoute}
                  onChange={(event) => update({ showRoute: event.target.checked })}
                />
              </label>

              <label className="toggle-field">
                <span>
                  <strong>ラウンド数制限</strong>
                  <small>上限到達時に勝敗を選択</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.roundLimit}
                  onChange={(event) =>
                    update({
                      roundLimit: event.target.checked,
                      maxRounds: event.target.checked
                        ? computeDefaultMaxRounds(settings.startScore)
                        : settings.maxRounds,
                    })
                  }
                />
              </label>

              {settings.roundLimit && (
                <label className="field">
                  <span>最大ラウンド数</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={settings.maxRounds}
                    onChange={(event) => update({ maxRounds: Number(event.target.value) })}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="field-section">
            <h2>プレイヤー設定</h2>
            <div className="players-setup">
              {([0, 1] as const).map((index) => (
                <div className="player-config" key={index}>
                  <label className="field">
                    <span>プレイヤー {index + 1}</span>
                    <div className="name-input">
                      <i aria-hidden="true">●</i>
                      <input
                        maxLength={18}
                        value={settings.names[index]}
                        aria-label={`プレイヤー${index + 1}の名前`}
                        onChange={(event) => {
                          const names: [string, string] = [...settings.names];
                          names[index] = event.target.value;
                          update({ names });
                        }}
                      />
                    </div>
                    <small>{index === 0 ? '最初のLegは先攻' : 'Legごとに先攻を交代'}</small>
                  </label>
                  <label className="toggle-field compact-toggle">
                    <span>
                      <strong>COM対戦</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.comEnabled[index]}
                      onChange={(event) => {
                        const comEnabled: [boolean, boolean] = [...settings.comEnabled];
                        comEnabled[index] = event.target.checked;
                        update({ comEnabled });
                      }}
                    />
                  </label>
                  {settings.comEnabled[index] && (
                    <label className="field">
                      <span>COMレベル</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={settings.comLevels[index]}
                        onChange={(event) => {
                          const comLevels: [number, number] = [...settings.comLevels];
                          comLevels[index] = Number(event.target.value);
                          update({ comLevels });
                        }}
                      />
                    </label>
                  )}
                  {settings.mode === '01' && (
                    <label className="toggle-field compact-toggle">
                      <span>
                        <strong>ハンディキャップ</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.handicapEnabled[index]}
                        onChange={(event) => {
                          const handicapEnabled: [boolean, boolean] = [...settings.handicapEnabled];
                          handicapEnabled[index] = event.target.checked;
                          update({ handicapEnabled });
                        }}
                      />
                    </label>
                  )}
                  {settings.mode === '01' && settings.handicapEnabled[index] && (
                    <label className="field">
                      <span>開始点数</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={settings.handicapScores[index]}
                        onChange={(event) => {
                          const handicapScores: [number, number] = [...settings.handicapScores];
                          handicapScores[index] = Number(event.target.value);
                          update({ handicapScores });
                        }}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stats-col">
          <StatsPanel history={history} onReset={() => setHistory([])} />
        </div>

        <div className="panel theme-panel">
          <ThemeSelect theme={theme} onChange={onChangeTheme} />
        </div>
      </section>
    </div>
  );
}
