/**
 * 私聊提示词里的「你的钱包」块（易变尾段，chatRequestPayload 挂载）。
 * 让角色知道自己有多少钱、这个月和用户来回转了多少——转账时照着余额来，
 * 不会穷角色突然甩一笔天价；余额不足的转账会被拦下（chatParser），这里先打招呼。
 * 角色没设余额、这个月也没往来时是空串；读失败也是空串。
 */
import type { CharacterProfile } from '../../types';
import { formatWalletMoney, monthStart, summarizePair, walletBalance } from './wallet';
import { getWalletState, listAllCharacterIds, loadWalletEntries } from './walletDb';

export async function loadWalletContextBlock(char: CharacterProfile, userName: string): Promise<string> {
    try {
        const state = await getWalletState();
        const entries = await loadWalletEntries(await listAllCharacterIds());
        const balance = walletBalance(char.id, state, entries);
        const month = summarizePair(char.id, entries, monthStart());
        if (balance === undefined && month.count === 0) return '';
        const lines: string[] = [];
        if (balance !== undefined) {
            lines.push(`- 你现在的余额：₩${formatWalletMoney(balance)}。这是你真实拥有的钱，转账/发红包的金额不能超过它——超过了转账会因余额不足失败。`);
        }
        if (month.count > 0) {
            lines.push(`- 这个月：你转给${userName} ₩${formatWalletMoney(month.charToUser)}，${userName}转给你 ₩${formatWalletMoney(month.userToChar)}。`);
        }
        if (month.pendingFromUser > 0) lines.push(`- ${userName}有 ${month.pendingFromUser} 笔转账你还没收下或退回。`);
        if (month.pendingFromChar > 0) lines.push(`- 你有 ${month.pendingFromChar} 笔转账${userName}还没处理（钱已经从你这里扣了）。`);
        lines.push('- 这些是背景信息，自然地放在心里即可，不用主动报账。');
        return `\n\n### [你的钱包]\n${lines.join('\n')}`;
    } catch (e) {
        console.warn('[Wallet] 钱包提示词读取失败，跳过:', e);
        return '';
    }
}
