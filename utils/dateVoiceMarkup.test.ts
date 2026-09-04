import { describe, expect, it } from 'vitest';
import {
    cleanDateTextForDisplay,
    extractDateDialogueSpeechText,
    extractDateDialogueText,
    isDateDialogueLine,
    parseDateDialogue,
    protectMiniMaxInterjectionsForTranslation,
} from './dateVoiceMarkup';

describe('见面台词的显示 / TTS 双通道', () => {
    it('显示隐藏 MiniMax 语气词，但 speechText 保留它们和独立语音情绪', () => {
        const [item] = parseDateDialogue('[happy] (chuckle) "真的吗？" (breath) [v:calm]');

        expect(item.text).toBe('"真的吗？"');
        expect(item.speechText).toBe('(chuckle) 真的吗？ (breath)');
        expect(item.emotion).toBe('happy');
        expect(item.voiceEmotion).toBe('calm');
    });

    it('支持语气词在引号内、前后和多段台词之间', () => {
        expect(extractDateDialogueSpeechText('(chuckle) "你好" (breath) "今天还好吗？" (sighs)'))
            .toBe('(chuckle) 你好 (breath) 今天还好吗？ (sighs)');
        expect(isDateDialogueLine('(chuckle) "你好"')).toBe(true);
    });

    it('普通括号不是语气词时仍保留在正文显示中', () => {
        const [item] = parseDateDialogue('[normal] "版本(2026) 还在测试"');

        expect(item.text).toBe('"版本(2026) 还在测试"');
        expect(item.speechText).toBe('版本(2026) 还在测试');
        expect(cleanDateTextForDisplay('(chuckle) 备注(2026)')).toBe('备注(2026)');
    });

    it('只有语气词的行不生成空白气泡', () => {
        expect(parseDateDialogue('(chuckle)\n(breath)')).toEqual([]);
    });

    it('旧格式仍能从显示文本提取纯台词作为回退朗读源', () => {
        expect(extractDateDialogueText('"旧记录"')).toBe('旧记录');
    });
});

describe('见面语音翻译的 MiniMax 标签保护', () => {
    it('翻译成功时还原每一个官方标签', () => {
        const protectedText = protectMiniMaxInterjectionsForTranslation('(chuckle) Hello (breath)');

        expect(protectedText.hasTags).toBe(true);
        expect(protectedText.text).toBe('SULLYMMVOICECUE0END Hello SULLYMMVOICECUE1END');
        expect(protectedText.restore('SULLYMMVOICECUE0END 你好 SULLYMMVOICECUE1END'))
            .toBe('(chuckle) 你好 (breath)');
    });

    it('占位符被翻译模型删掉或改写时返回 null，让调用方回退原文', () => {
        const protectedText = protectMiniMaxInterjectionsForTranslation('(chuckle) Hello');

        expect(protectedText.restore('你好')).toBeNull();
        expect(protectedText.restore('SULLYMMVOICECUE0END SULLYMMVOICECUE0END 你好')).toBeNull();
    });
});
