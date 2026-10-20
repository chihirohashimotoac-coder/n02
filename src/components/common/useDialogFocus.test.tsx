import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DialogShell from './DialogShell';

/**
 * The guardKeys contract of useDialogFocus, as the X01 play screens use it: a window-level gameplay
 * listener sits behind the dialog, exactly like GameScreen's.
 */
describe('useDialogFocus guardKeys', () => {
  let behind: ReturnType<typeof vi.fn>;
  const listener = (event: KeyboardEvent) => behind(event.key);

  beforeEach(() => {
    behind = vi.fn();
    window.addEventListener('keydown', listener);
  });
  afterEach(() => window.removeEventListener('keydown', listener));

  function setup(guardKeys: boolean) {
    const onClose = vi.fn();
    const onKeyDown = vi.fn();
    const onFieldKey = vi.fn();
    render(
      <DialogShell
        label="test"
        backdropClassName="b"
        cardClassName="c"
        onClose={onClose}
        onKeyDown={onKeyDown}
        guardKeys={guardKeys}
      >
        <button type="button">first</button>
        <input aria-label="field" onKeyDown={(event) => onFieldKey(event.key)} />
        <button type="button">last</button>
      </DialogShell>,
    );
    return { onClose, onKeyDown, onFieldKey, button: screen.getByText('first'), field: screen.getByLabelText('field') };
  }

  it('keeps plain dialog keys working', () => {
    const { onClose, onKeyDown, button } = setup(true);
    fireEvent.keyDown(button, { key: '1' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it('does not act on IME, repeat or Ctrl/Meta/Alt keystrokes, and still keeps them from the game', () => {
    const { onClose, onKeyDown, button } = setup(true);
    fireEvent.keyDown(button, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(button, { key: 'Escape', repeat: true });
    fireEvent.keyDown(button, { key: '1', ctrlKey: true });
    fireEvent.keyDown(button, { key: 'a', metaKey: true });
    fireEvent.keyDown(button, { key: 'Enter', altKey: true });
    fireEvent.keyDown(button, { key: 'Enter', keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(behind).not.toHaveBeenCalled();
  });

  it('suppresses only the repeated native click of a held Enter / Space', () => {
    const { button } = setup(true);
    expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false);
    expect(fireEvent.keyDown(button, { key: ' ', repeat: true })).toBe(false);
    // A single press keeps its default action (the native button click).
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
  });

  it("lets the dialog's own field handle its keys, but not the game behind it", () => {
    const { onClose, onKeyDown, onFieldKey, field } = setup(true);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'a', ctrlKey: true });
    expect(onFieldKey).toHaveBeenCalledWith('Enter');
    expect(onFieldKey).toHaveBeenCalledWith('a');
    expect(onKeyDown).not.toHaveBeenCalled();
    // Escape while an IME is converting belongs to the IME, not to the dialog.
    fireEvent.keyDown(field, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(behind).not.toHaveBeenCalled();
  });

  it('keeps Tab from the game behind the dialog', () => {
    const { button } = setup(true);
    fireEvent.keyDown(button, { key: 'Tab' });
    expect(behind).not.toHaveBeenCalled();
  });

  it('wraps Tab at the edges but leaves Ctrl+Tab to the browser', () => {
    setup(true);
    const last = screen.getByText('last');
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab', ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(screen.getByText('first'));
    expect(behind).not.toHaveBeenCalled();
  });

  it('leaves dialogs that did not opt in exactly as before', () => {
    const { onClose, onKeyDown, button } = setup(false);
    fireEvent.keyDown(button, { key: '1', ctrlKey: true });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(button, { key: 'Escape', isComposing: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
