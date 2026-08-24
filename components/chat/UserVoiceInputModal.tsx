import React, { useEffect, useRef, useState } from 'react';
import { Microphone, PaperPlaneTilt, Stop, TextT } from '@phosphor-icons/react';
import type { APIConfig } from '../../types';
import Modal from '../os/Modal';
import { isSttSupported, releaseSiliconFlowMicrophone, startStt, type SttSession } from '../../utils/speechToText';

interface UserVoiceInputModalProps {
    isOpen: boolean;
    apiConfig: APIConfig;
    onClose: () => void;
    onSend: (text: string, audio: Blob | null, durationSeconds: number) => Promise<void> | void;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const UserVoiceInputModal: React.FC<UserVoiceInputModalProps> = ({ isOpen, apiConfig, onClose, onSend, addToast }) => {
    const [mode, setMode] = useState<'speech' | 'text'>('speech');
    const [text, setText] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [audio, setAudio] = useState<Blob | null>(null);
    const [duration, setDuration] = useState(0);
    const sessionRef = useRef<SttSession | null>(null);
    const runIdRef = useRef(0);

    const provider = apiConfig.speechRecognitionProvider || 'system';
    const providerName = provider === 'siliconflow-telespeech'
        ? 'TeleSpeech ASR'
        : provider === 'siliconflow-sensevoice' ? 'SenseVoice Small' : '系统识别';

    useEffect(() => {
        if (!isOpen) {
            runIdRef.current += 1;
            sessionRef.current?.stop();
            sessionRef.current = null;
            releaseSiliconFlowMicrophone();
            return;
        }
        runIdRef.current += 1;
        sessionRef.current = null;
        setMode('speech');
        setText('');
        setAudio(null);
        setDuration(0);
        setIsRecording(false);
        setIsProcessing(false);
        setIsSending(false);
    }, [isOpen]);

    const stopRecording = () => {
        sessionRef.current?.stop();
        sessionRef.current = null;
    };

    const close = () => {
        runIdRef.current += 1;
        stopRecording();
        releaseSiliconFlowMicrophone();
        onClose();
    };

    const beginRecording = async () => {
        if (isRecording || isProcessing) return;
        if (!isSttSupported(provider)) {
            addToast('当前浏览器不支持录音，请切换到手动输入', 'error');
            return;
        }
        if (provider !== 'system' && !apiConfig.siliconFlowSpeechApiKey?.trim()) {
            addToast('请先到设置 → 其他 API 填写 SiliconFlow Key', 'info');
            return;
        }

        const runId = ++runIdRef.current;
        setText('');
        setAudio(null);
        setDuration(0);
        setIsRecording(true);
        setIsProcessing(false);
        try {
            sessionRef.current = await startStt('zh-CN', {
                onPartial: value => { if (runIdRef.current === runId) setText(value); },
                onFinal: value => { if (runIdRef.current === runId) setText(value); },
                onAudio: (blob, seconds) => {
                    if (runIdRef.current !== runId) return;
                    setAudio(blob);
                    setDuration(seconds);
                },
                onRecordingEnd: () => {
                    if (runIdRef.current !== runId) return;
                    setIsRecording(false);
                    setIsProcessing(provider !== 'system');
                },
                onProviderFallback: message => addToast(message, 'info'),
                onError: message => {
                    if (runIdRef.current !== runId) return;
                    if (message) addToast(message, 'error');
                },
                onEnd: () => {
                    if (runIdRef.current !== runId) return;
                    sessionRef.current = null;
                    setIsRecording(false);
                    setIsProcessing(false);
                },
            }, {
                provider,
                apiKey: apiConfig.siliconFlowSpeechApiKey,
                stripEmoji: apiConfig.speechRecognitionStripEmoji !== false,
                fallbackToSenseVoice: true,
            });
        } catch (error: any) {
            if (runIdRef.current === runId) {
                setIsRecording(false);
                setIsProcessing(false);
                addToast(error?.message || '无法开始语音识别', 'error');
            }
        }
    };

    const send = async () => {
        const transcript = text.trim();
        if (!transcript || isRecording || isProcessing || isSending) return;
        setIsSending(true);
        try {
            await onSend(transcript, audio, duration);
            close();
        } catch (error: any) {
            addToast(error?.message || '语音消息发送失败', 'error');
        } finally {
            setIsSending(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            title="发送语音"
            onClose={close}
            footer={(
                <>
                    <button onClick={close} disabled={isSending} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 disabled:opacity-50">取消</button>
                    <button
                        onClick={() => void send()}
                        disabled={!text.trim() || isRecording || isProcessing || isSending}
                        className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl active:scale-95 disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                        <PaperPlaneTilt size={17} weight="fill" />{isSending ? '发送中' : '按语音发送'}
                    </button>
                </>
            )}
        >
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
                    <button onClick={() => setMode('speech')} className={`py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${mode === 'speech' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}><Microphone size={17} />说话识别</button>
                    <button onClick={() => { stopRecording(); setMode('text'); }} className={`py-2 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 ${mode === 'text' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}><TextT size={17} />手动输入</button>
                </div>

                {mode === 'speech' && (
                    <div className="text-center">
                        <button
                            onClick={isRecording ? stopRecording : () => void beginRecording()}
                            disabled={isProcessing}
                            className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all disabled:opacity-50 ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-primary text-white'}`}
                        >
                            {isRecording ? <Stop size={30} weight="fill" /> : <Microphone size={32} weight="fill" />}
                        </button>
                        <p className="mt-2 text-xs text-slate-400">
                            {isRecording ? '正在录音，点一下结束' : isProcessing ? `${providerName} 正在识别…` : `当前：${providerName}`}
                        </p>
                    </div>
                )}

                <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                        <span>{mode === 'speech' ? '识别结果（发送前可修改）' : '文字会被作为语音消息发送'}</span>
                        {audio && <span>已保留录音 · {Math.max(1, Math.round(duration))} 秒</span>}
                    </div>
                    <textarea
                        value={text}
                        onChange={event => setText(event.target.value)}
                        rows={6}
                        placeholder={mode === 'speech' ? '点麦克风开始说话…' : '输入要作为语音发送的内容…'}
                        className="w-full min-h-36 max-h-64 resize-y rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-[15px] leading-relaxed outline-none focus:border-primary/50"
                    />
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                    云端模型会把录音直接发送给 SiliconFlow 转写；Key 只保存在本机设置中。手动输入不会生成录音，但角色仍会把它理解成一条语音消息。
                </p>
            </div>
        </Modal>
    );
};

export default UserVoiceInputModal;
