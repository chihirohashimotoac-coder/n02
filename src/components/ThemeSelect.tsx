import type { ThemeName } from '../storage/matchStorage';

const THEMES: Array<{ value: ThemeName; label: string }> = [
  { value: 'clean', label: 'クリーン・スポーツ' },
  { value: 'neon', label: 'ネオン・スコアボード' },
  { value: 'navy', label: 'ネイビー＆ゴールド' },
];

interface Props {
  theme: ThemeName;
  onChange: (theme: ThemeName) => void;
}

export default function ThemeSelect({ theme, onChange }: Props) {
  return (
    <label className="field theme-field">
      <span>テーマ</span>
      <select value={theme} onChange={(event) => onChange(event.target.value as ThemeName)}>
        {THEMES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
