import type { CharacterProfile, VRWorldCharState } from '../../types';
import { VR_DEFAULT_INTERVAL_MIN } from './constants';

/** 旧接入沿用自动设置；新接入默认等待用户邀请。 */
export const joinVRState = (previous?: VRWorldCharState): VRWorldCharState => ({
    ...previous,
    enabled: true,
    activityMode: previous?.activityMode ?? (previous?.enabled ? 'scheduled' : 'manual'),
    intervalMinutes: previous?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN,
});

export const allowsAutomaticVR = (state?: VRWorldCharState): boolean =>
    Boolean(state?.enabled && state.activityMode !== 'manual');

/**
 * 已接入彼方的角色都能收到用户发布的彼方动态。
 * 日程忙碌/睡眠只限制角色自己的活动资格，不影响它读取用户消息。
 */
export const isVRDynamicRecipient = (char: Pick<CharacterProfile, 'vrState'>): boolean =>
    Boolean(char.vrState?.enabled);

/** Connecting to Kanata alone does not place a character in SAR. */
export const isSARActivityOccupant = (char: Pick<CharacterProfile,'vrState'>): boolean => {
    const state=char.vrState;
    return !!state?.enabled&&state.currentRoom==='sar'&&
        ['cabinet','module-shop','fishing','market','garden'].includes(state.sarActivity||'');
};

/** 一轮生成期间用户可能切换接入方式；保存活动结果不能恢复会话开始时的旧开关。 */
export const withLatestVRParticipation = (current: CharacterProfile, patch: Partial<CharacterProfile>): Partial<CharacterProfile> => {
    if (!patch.vrState) return patch;
    return {
        ...patch,
        vrState: {
            ...patch.vrState,
            title: current.vrState?.title,
            titleRevision: current.vrState?.titleRevision,
            novelReadingMode: current.vrState?.novelReadingMode,
            preferredNovelIds: current.vrState?.preferredNovelIds,
            preferredNovelCategoryIds: current.vrState?.preferredNovelCategoryIds,
            excludedAutoRooms: current.vrState?.excludedAutoRooms,
            excludedAutoSARActivities: current.vrState?.excludedAutoSARActivities,
            enabled: current.vrState?.enabled ?? false,
            activityMode: current.vrState?.activityMode,
            intervalMinutes: current.vrState?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN,
        },
    };
};
