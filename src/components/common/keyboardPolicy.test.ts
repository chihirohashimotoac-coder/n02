import { describe, expect, it } from 'vitest';
import { hasCommandModifier, isFieldOwned, isInertKeystroke, isNativeActivation } from './keyboardPolicy';

const key = (init: KeyboardEventInit & { keyCode?: number }) => new KeyboardEvent('keydown', init);

describe('isInertKeystroke', () => {
  it('lets a plain key and a Shift chord act', () => {
    expect(isInertKeystroke(key({ key: '6' }))).toBe(false);
    expect(isInertKeystroke(key({ key: 'Enter' }))).toBe(false);
    // Shift+Tab commits like Tab, and a capital F/M/S/N/U/R is still the shortcut.
    expect(isInertKeystroke(key({ key: 'Tab', shiftKey: true }))).toBe(false);
    expect(isInertKeystroke(key({ key: 'N', shiftKey: true }))).toBe(false);
  });

  it('ignores IME composition, including the Enter that commits it', () => {
    expect(isInertKeystroke(key({ key: 'Enter', isComposing: true }))).toBe(true);
    expect(isInertKeystroke(key({ key: 'Process', keyCode: 229 }))).toBe(true);
  });

  it('ignores a held key', () => {
    expect(isInertKeystroke(key({ key: 'u', repeat: true }))).toBe(true);
  });

  it('ignores Ctrl / Meta / Alt chords', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(isInertKeystroke(key({ key: 'n', [modifier]: true }))).toBe(true);
      expect(isInertKeystroke(key({ key: '1', [modifier]: true }))).toBe(true);
    }
    expect(hasCommandModifier(key({ key: 'n', shiftKey: true }))).toBe(false);
  });

  it('ignores a keystroke something else already handled', () => {
    const event = key({ key: 'Enter', cancelable: true });
    event.preventDefault();
    expect(isInertKeystroke(event)).toBe(true);
  });
});

describe('isFieldOwned', () => {
  const mount = (html: string) => {
    document.body.innerHTML = html;
    return (selector: string) => document.querySelector(selector);
  };

  it('gives the score sheet its own read-only entry box', () => {
    const $ = mount(
      '<table class="n01-score-table"><tr><td class="scored current"><input readonly id="live"></td></tr></table>',
    );
    expect(isFieldOwned($('#live'))).toBe(false);
  });

  it('leaves every other field its own keys, read-only or not', () => {
    const $ = mount(`
      <table class="n01-score-table"><tr><td class="scored"><input readonly id="past"></td></tr></table>
      <input readonly id="other-readonly">
      <input type="number" id="edit">
      <select id="names"><option>1</option></select>
      <textarea id="notes"></textarea>
    `);
    for (const id of ['#past', '#other-readonly', '#edit', '#names', '#notes']) {
      expect(isFieldOwned($(id))).toBe(true);
    }
  });

  it('treats buttons and the window as game-owned', () => {
    const $ = mount('<button id="b">1</button>');
    expect(isFieldOwned($('#b'))).toBe(false);
    expect(isFieldOwned(window)).toBe(false);
    expect(isFieldOwned(null)).toBe(false);
  });
});

describe('isNativeActivation', () => {
  it('is Enter / Space / Tab on a focused button or link only', () => {
    document.body.innerHTML = '<button id="b"></button><a href="#" id="a"></a><div id="d"></div>';
    const on = (id: string, k: string) => {
      const event = key({ key: k, bubbles: true });
      let result = false;
      document.getElementById(id)!.addEventListener('keydown', (e) => (result = isNativeActivation(e)), {
        once: true,
      });
      document.getElementById(id)!.dispatchEvent(event);
      return result;
    };
    expect(on('b', 'Enter')).toBe(true);
    expect(on('b', ' ')).toBe(true);
    expect(on('a', 'Tab')).toBe(true);
    expect(on('b', '5')).toBe(false);
    expect(on('d', 'Enter')).toBe(false);
  });
});
