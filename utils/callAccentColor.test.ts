import { describe, expect, it } from 'vitest';
import { CALL_ACCENT_FALLBACK, normalizeCallAccentColor } from './callAccentColor';

describe('normalizeCallAccentColor', () => {
  it('keeps a normal hex color', () => {
    expect(normalizeCallAccentColor('#f472b6')).toBe('#f472b6');
    expect(normalizeCallAccentColor('#abc')).toBe('#aabbcc');
  });
  it('falls back for transparent / mostly transparent colors', () => {
    for (const raw of ['transparent', '#ffffff00', 'rgba(255,255,255,0.1)', '', undefined]) {
      expect(normalizeCallAccentColor(raw)).toBe(CALL_ACCENT_FALLBACK);
    }
  });
  it('turns opaque rgb/rgba and 8-digit hex into #rrggbb', () => {
    expect(normalizeCallAccentColor('rgb(244, 114, 182)')).toBe('#f472b6');
    expect(normalizeCallAccentColor('rgba(244,114,182,0.9)')).toBe('#f472b6');
    expect(normalizeCallAccentColor('#f472b6cc')).toBe('#f472b6');
  });
  it('takes the first usable color from a gradient', () => {
    expect(normalizeCallAccentColor('linear-gradient(135deg, #f472b6, #6366f1)')).toBe('#f472b6');
  });
  it('falls back for too-dark colors', () => {
    expect(normalizeCallAccentColor('#000000')).toBe(CALL_ACCENT_FALLBACK);
  });
});
