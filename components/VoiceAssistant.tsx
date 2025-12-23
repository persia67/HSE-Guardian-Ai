
import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Activity, Volume2, XCircle, Play, Loader2 } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { checkLicense } from '../services/licenseService';

// Audio Utility Functions for Raw PCM Processing
function floatTo16BitPCM(input: Float32Array) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

export default function VoiceAssistant() {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [volume, setVolume] = useState(0);
    const [assistantStatus, setAssistantStatus] = useState<'IDLE' | 'LISTENING' | 'SPEAKING'>('IDLE');

    // Refs for Audio Management
    const audioContextRef = useRef<AudioContext | null>(null);
    const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const sessionPromiseRef = useRef<Promise<any> | null>(null);

    // Visualizer Loop
    const animationFrameRef = useRef<number>();

    const cleanup = () => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (inputSourceRef.current) {
            inputSourceRef.current.disconnect();
            inputSourceRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        setIsConnected(false);
        setIsConnecting(false);
        setAssistantStatus('IDLE');
        setVolume(0);
        nextStartTimeRef.current = 0;
    };

    const startSession = async () => {
        setError(null);
        setIsConnecting(true);

        try {
            // 1. License Check
            if (!checkLicense()) {
                throw new Error("License validation failed. Voice features disabled.");
            }

            // 2. API Key Check
            const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : null;
            if (!apiKey) throw new Error("API Key missing.");

            // 3. Audio Context Setup (Output)
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioCtx = new AudioContextClass({ sampleRate: 24000 }); // Output usually 24k
            audioContextRef.current = audioCtx;
            nextStartTimeRef.current = audioCtx.currentTime;

            // 4. Input Setup (Microphone)
            // We need 16kHz for Gemini Input
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });
            streamRef.current = stream;

            // 5. Initialize Gemini Client
            const ai = new GoogleGenAI({ apiKey });

            // 6. Connect to Live API
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                    },
                    systemInstruction: `You are "HSE Guardian Voice", an expert industrial safety assistant. 
                    Your role is to help safety officers by:
                    1. Answering technical questions about safety protocols (OSHA, HSE standards).
                    2. Providing immediate advice on handling hazards.
                    3. Keeping responses concise, professional, and audible in a noisy environment.
                    Speak clearly. If you detect urgency, be direct.`,
                },
                callbacks: {
                    onopen: () => {
                        console.log("Gemini Live Session Opened");
                        setIsConnected(true);
                        setIsConnecting(false);
                        setAssistantStatus('LISTENING');

                        // Start Audio Pipeline only after connection
                        setupAudioPipeline(audioCtx, stream, sessionPromise);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // Handle Audio Output
                        const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (audioData) {
                            setAssistantStatus('SPEAKING');
                            await queueAudioOutput(audioData, audioCtx);
                        }

                        // Handle Interruption
                        if (message.serverContent?.interrupted) {
                            console.log("Interrupted!");
                            nextStartTimeRef.current = audioCtx.currentTime;
                            setAssistantStatus('LISTENING');
                        }

                        // Check turn complete to switch back status
                        if (message.serverContent?.turnComplete) {
                             setTimeout(() => {
                                 setAssistantStatus('LISTENING');
                             }, 500); // Small delay to let audio finish logic roughly
                        }
                    },
                    onclose: () => {
                        console.log("Session Closed");
                        cleanup();
                    },
                    onerror: (e) => {
                        console.error("Session Error", e);
                        setError("Connection lost. Please try again.");
                        cleanup();
                    }
                }
            });
            
            sessionPromiseRef.current = sessionPromise;

        } catch (e) {
            console.error("Start Session Error", e);
            setError((e as Error).message);
            cleanup();
        }
    };

    const setupAudioPipeline = (ctx: AudioContext, stream: MediaStream, sessionPromise: Promise<any>) => {
        // Create Input Source
        const source = ctx.createMediaStreamSource(stream);
        inputSourceRef.current = source;

        // Visualizer Analyzer
        const analyzer = ctx.createAnalyser();
        analyzer.fftSize = 256;
        source.connect(analyzer);

        // Processor for sending data
        // Buffer size 4096 is standard for ScriptProcessor
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Calculate Volume for Visualizer
            let sum = 0;
            for(let i=0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
            const rms = Math.sqrt(sum / inputData.length);
            setVolume(Math.min(rms * 5, 1)); // Scale for UI

            // Downsample/Convert to PCM 16-bit
            // Note: If context is already 16k (from getUserMedia), we just convert float to int16.
            // If context is 44.1k/48k, we ideally rely on Gemini to handle it or downsample.
            // For simplicity here, we assume getUserMedia tried 16k, or we send raw PCM.
            // Gemini expects 'audio/pcm;rate=16000'.
            // If the browser didn't give 16k, we are sending wrong rate data which sounds pitch-shifted.
            // *Optimization*: In a full prod app, implement a true Resampler. 
            // Here we proceed with raw buffer conversion.
            
            const pcm16 = floatTo16BitPCM(inputData);
            const base64Data = arrayBufferToBase64(pcm16.buffer);

            sessionPromise.then((session) => {
                 session.sendRealtimeInput({
                    media: {
                        mimeType: `audio/pcm;rate=${ctx.sampleRate}`, // Send actual rate so model adjusts
                        data: base64Data
                    }
                 });
            });
        };

        source.connect(processor);
        processor.connect(ctx.destination); // Required for script processor to run, but mute it to prevent echo?
        // Actually, connecting to destination might cause feedback if not careful. 
        // We typically connect to a GainNode(0) -> Destination to keep the graph alive but silent locally.
        const muteGain = ctx.createGain();
        muteGain.gain.value = 0;
        processor.connect(muteGain);
        muteGain.connect(ctx.destination);
    };

    const queueAudioOutput = async (base64Data: string, ctx: AudioContext) => {
        try {
            const arrayBuffer = base64ToArrayBuffer(base64Data);
            const int16Array = new Int16Array(arrayBuffer);
            
            // Convert Int16 PCM to Float32 for Web Audio API
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            const buffer = ctx.createBuffer(1, float32Array.length, 24000); // Model output is usually 24k
            buffer.copyToChannel(float32Array, 0);

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);

            // Schedule playback
            const scheduleTime = Math.max(ctx.currentTime, nextStartTimeRef.current);
            source.start(scheduleTime);
            nextStartTimeRef.current = scheduleTime + buffer.duration;

        } catch (e) {
            console.error("Audio Decode Error", e);
        }
    };

    // Auto-cleanup on unmount
    useEffect(() => {
        return () => cleanup();
    }, []);

    return (
        <div className="flex flex-col items-center justify-center h-full p-6 relative overflow-hidden">
            {/* Background Decoration */}
            <div className={`absolute inset-0 transition-opacity duration-1000 pointer-events-none ${isConnected ? 'opacity-100' : 'opacity-0'}`}>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse"></div>
            </div>

            <div className="z-10 text-center max-w-lg w-full">
                <div className="mb-8">
                    <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">HSE Voice Assistant</h2>
                    <p className="text-slate-400">
                        {isConnected 
                            ? "Listening... Ask about safety protocols or hazards." 
                            : "Connect to start a real-time voice session with AI."}
                    </p>
                </div>

                {/* Main Interaction Area */}
                <div className="relative flex items-center justify-center mb-12">
                    {/* Visualizer Ring */}
                    {isConnected && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-48 h-48 rounded-full border-2 border-blue-500/30 animate-[spin_10s_linear_infinite]"></div>
                            <div 
                                className="absolute w-40 h-40 rounded-full bg-blue-500/20 blur-md transition-all duration-100"
                                style={{ transform: `scale(${1 + volume})` }}
                            ></div>
                        </div>
                    )}

                    {/* Button */}
                    <button
                        onClick={isConnected ? cleanup : startSession}
                        disabled={isConnecting}
                        className={`relative w-32 h-32 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
                            isConnected 
                                ? 'bg-red-500 hover:bg-red-600 shadow-red-900/50' 
                                : isConnecting 
                                    ? 'bg-slate-700 cursor-wait'
                                    : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/50 hover:scale-105'
                        }`}
                    >
                        {isConnecting ? (
                            <Loader2 className="w-12 h-12 text-white animate-spin" />
                        ) : isConnected ? (
                            <MicOff className="w-12 h-12 text-white" />
                        ) : (
                            <Mic className="w-12 h-12 text-white" />
                        )}
                    </button>
                    
                    {/* Status Badge */}
                    {isConnected && (
                        <div className="absolute -bottom-16">
                            <div className={`flex items-center gap-2 px-4 py-2 rounded-full border backdrop-blur-md ${
                                assistantStatus === 'SPEAKING' 
                                    ? 'bg-emerald-900/50 border-emerald-500 text-emerald-400' 
                                    : 'bg-slate-800/50 border-slate-600 text-blue-400'
                            }`}>
                                {assistantStatus === 'SPEAKING' ? <Volume2 className="w-4 h-4 animate-pulse" /> : <Activity className="w-4 h-4" />}
                                <span className="text-xs font-bold tracking-widest uppercase">
                                    {assistantStatus}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Error Message */}
                {error && (
                    <div className="bg-red-900/20 border border-red-500/50 text-red-200 p-4 rounded-xl flex items-center justify-center gap-3 animate-fadeIn">
                        <XCircle className="w-5 h-5" />
                        <span className="text-sm">{error}</span>
                    </div>
                )}

                {/* Hints */}
                {!isConnected && !error && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 opacity-70">
                        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 text-xs text-slate-400 text-center">
                            "What are the PPE requirements for welding?"
                        </div>
                        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 text-xs text-slate-400 text-center">
                            "How do I handle a chemical spill?"
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
