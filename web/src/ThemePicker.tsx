import { SYSTEM, THEMES } from "./themes";

/** Predefined editor themes; the app chrome follows whichever is chosen. */

interface ThemePickerProps {
  readonly choice: string;
  readonly onChange: (id: string) => void;
}

export function ThemePicker({ choice, onChange }: ThemePickerProps) {
  const light = THEMES.filter((theme) => !theme.dark);
  const dark = THEMES.filter((theme) => theme.dark);

  return (
    <label className="themepicker">
      <span className="seg-label">Theme</span>
      <select value={choice} onChange={(event) => onChange(event.target.value)}>
        <option value={SYSTEM}>Follow system</option>
        <optgroup label="Light">
          {light.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Dark">
          {dark.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
