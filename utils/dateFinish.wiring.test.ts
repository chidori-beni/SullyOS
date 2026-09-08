import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('结束见面不会复活恢复快照', () => {
  it('DateSession 在结束成功后的卸载不会再自动保存旧状态', () => {
    const source = read('../components/date/DateSession.tsx');
    const endAt = source.indexOf('const handleEndClick = async');
    const autoSaveAt = source.indexOf('const saveStateToDB = () =>', endAt);
    const cleanupAt = source.indexOf('return () => {', autoSaveAt);

    expect(endAt).toBeGreaterThan(-1);
    expect(source.slice(endAt, autoSaveAt)).toContain('endingEncounterRef.current = true;');
    expect(source.slice(autoSaveAt, cleanupAt)).toContain('if (endingEncounterRef.current) return;');
    expect(source.slice(cleanupAt, cleanupAt + 900)).toContain('if (!endingEncounterRef.current) saveStateToDB();');
  });

  it('DateApp 正式结束时会在回到聊天前同时清理活动现场和恢复快照', () => {
    const source = read('../apps/DateApp.tsx');
    const finishAt = source.indexOf('const finishEncounter = async');
    const returnAt = source.indexOf('returnToChat();', finishAt);
    const clearAt = source.indexOf('clearDateEncounter(char.id, encounter.id, { clearSavedDateState: true });', finishAt);

    expect(finishAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(finishAt);
    expect(clearAt).toBeLessThan(returnAt);
    expect(source.slice(clearAt - 500, clearAt + 180)).toContain('clearSavedDateState: true');
  });
});
