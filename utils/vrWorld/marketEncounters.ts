/** Prewritten game fiction, never executable commands or an additional reward source. */
export interface MarketNPCPersona { name: string; identity: string }
export interface MarketEncounter { story: string }
export interface MarketEncounterResult {
    participantId: string; participantName: string; story: string; reaction?: string;
}
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
export const validMarketPersona = (v: unknown): v is MarketNPCPersona => {
    const p = v as MarketNPCPersona | undefined;
    return !!p && bounded(p.name, 24) && bounded(p.identity, 100);
};
export const validMarketEncounter = (v: unknown): v is MarketEncounter => !!v && bounded((v as MarketEncounter).story, 600);
export const validMarketEncounterResult = (v: unknown): v is MarketEncounterResult => {
    const r = v as MarketEncounterResult | undefined;
    return !!r && bounded(r.participantId, 200) && bounded(r.participantName, 200) && bounded(r.story, 1200)
        && (r.reaction === undefined || bounded(r.reaction, 600));
};
export const realizeMarketEncounter = (event: MarketEncounter, participant: { id: string; name: string }, reaction = ''): MarketEncounterResult => ({
    participantId: participant.id, participantName: participant.name,
    story: event.story.replaceAll('{{participant}}', participant.name).slice(0, 1200),
    ...(reaction.trim() ? { reaction: reaction.trim().slice(0, 600) } : {}),
});
export const marketEncounterText = (result: MarketEncounterResult): string =>
    '路人小事件（彼方游戏内）：' + result.story + (result.reaction ? '\n' + result.participantName + '的反应：' + result.reaction : '');
