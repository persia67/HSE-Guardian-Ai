import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, AlertTriangle, CheckCircle, Pause, Play, CameraOff, Settings, Volume2, VolumeX, Bell, X, Zap, List } from 'lucide-react';
import { analyzeSafetyImage } from '../services/geminiService';
import { SafetyAnalysis, LogEntry } from '../types';

interface MonitorProps {
  onNewAnalysis: (analysis: LogEntry) => void;
}

interface AlertSettings {
  minSafetyScore: number;
  alertOnHighSeverity: boolean;
  soundEnabled: boolean;
}

const Monitor: React.FC<MonitorProps> = ({ onNewAnalysis }) => {
  const webcamRef = useRef<Webcam>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<SafetyAnalysis | null>(null);
  const [intervalId, setIntervalId] = useState<ReturnType<typeof setInterval> | null>(null);
  const [latency, setLatency] = useState<number>(0);
  
  // Alert State
  const [showSettings, setShowSettings] = useState(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>({
    minSafetyScore: 60,
    alertOnHighSeverity: true,
    soundEnabled: true
  });
  const [isAlertActive, setIsAlertActive] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Sound Logic
  const startAlarm = useCallback(() => {
    if (!alertSettings.soundEnabled || oscillatorRef.current) return;

    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.setTargetAtTime(440, ctx.currentTime + 0.5, 0.1); // Drop to A4

      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      
      // Pulse effect
      setInterval(() => {
        if(gainNodeRef.current && ctx.state === 'running') {
            const now = ctx.currentTime;
            gain.gain.setValueAtTime(0.5, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            if(oscillatorRef.current) {
               oscillatorRef.current.frequency.setValueAtTime(880, now);
               oscillatorRef.current.frequency.exponentialRampToValueAtTime(440, now + 0.4);
            }
        }
      }, 800);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      oscillatorRef.current = osc;
      gainNodeRef.current = gain;
    } catch (e) {
      console.error("Audio play failed", e);
    }
  }, [alertSettings.soundEnabled]);

  const stopAlarm = useCallback(() => {
    if (oscillatorRef.current) {
      try {
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
      } catch (e) {}
      oscillatorRef.current = null;
    }
    // We don't close the context to allow reuse, but we stop the osc
  }, []);

  // Check thresholds
  const checkAlerts = useCallback((analysis: SafetyAnalysis) => {
    let shouldTrigger = false;

    if (analysis.safetyScore < alertSettings.minSafetyScore) {
      shouldTrigger = true;
    }

    if (alertSettings.alertOnHighSeverity && analysis.hazards.some(h => h.severity === 'HIGH')) {
      shouldTrigger = true;
    }

    if (shouldTrigger && !isAlertActive) {
      setIsAlertActive(true);
      startAlarm();
    }
  }, [alertSettings, isAlertActive, startAlarm]);

  const acknowledgeAlert = () => {
    setIsAlertActive(false);
    stopAlarm();
  };

  const captureAndAnalyze = useCallback(async () => {
    if (webcamRef.current && !isAnalyzing) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        setIsAnalyzing(true);
        const base64Data = imageSrc.split(',')[1];
        
        try {
          const startTime = performance.now();
          const result = await analyzeSafetyImage(base64Data);
          const endTime = performance.now();
          setLatency(Math.round(endTime - startTime));

          setLastAnalysis(result);
          checkAlerts(result); // Check thresholds
          
          onNewAnalysis({
            id: Date.now().toString(),
            ...result,
            thumbnail: imageSrc
          });
        } catch (e) {
          console.error("Analysis loop error", e);
        } finally {
          setIsAnalyzing(false);
        }
      }
    }
  }, [isAnalyzing, onNewAnalysis, checkAlerts]);

  const toggleMonitoring = () => {
    if (isMonitoring) {
      if (intervalId) clearInterval(intervalId);
      setIsMonitoring(false);
    } else {
      setIsMonitoring(true);
      // Initialize Audio Context on user interaction to handle browser policies
      if (!audioContextRef.current) {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContext();
      }

      captureAndAnalyze(); 
      const id = setInterval(captureAndAnalyze, 10000); 
      setIntervalId(id);
    }
  };

  useEffect(() => {
    return () => {
      if (intervalId) clearInterval(intervalId);
      stopAlarm();
    };
  }, [intervalId, stopAlarm]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full relative">
      
      {/* Alert Overlay */}
      {isAlertActive && (
        <div className="absolute inset-0 z-50 bg-red-500/20 backdrop-blur-sm flex items-center justify-center animate-pulse rounded-xl border-4 border-red-600 pointer-events-none">
           <div className="bg-slate-900 border-2 border-red-500 p-8 rounded-2xl shadow-2xl flex flex-col items-center pointer-events-auto">
             <AlertTriangle className="w-20 h-20 text-red-500 mb-4 animate-bounce" />
             <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-widest">Critical Alert</h2>
             <p className="text-red-200 mb-6 text-center">Safety thresholds have been breached.<br/>Immediate action required.</p>
             <button 
               onClick={acknowledgeAlert}
               className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:shadow-red-900/50 transition-all flex items-center gap-2"
             >
               <Bell className="w-5 h-5" /> Acknowledge & Silence
             </button>
           </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-400" /> Configuration
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex justify-between">
                  <span>Minimum Safety Score</span>
                  <span className="text-orange-400 font-bold">{alertSettings.minSafetyScore}</span>
                </label>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={alertSettings.minSafetyScore}
                  onChange={(e) => setAlertSettings(prev => ({...prev, minSafetyScore: parseInt(e.target.value)}))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
                <p className="text-xs text-slate-500 mt-1">Alert triggers if score falls below this value.</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                <div className="flex flex-col">
                  <span className="text-slate-200 font-medium">High Severity Hazards</span>
                  <span className="text-xs text-slate-400">Trigger alert on HIGH risk items</span>
                </div>
                <button 
                  onClick={() => setAlertSettings(prev => ({...prev, alertOnHighSeverity: !prev.alertOnHighSeverity}))}
                  className={`w-12 h-6 rounded-full relative transition-colors ${alertSettings.alertOnHighSeverity ? 'bg-orange-600' : 'bg-slate-600'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${alertSettings.alertOnHighSeverity ? 'left-7' : 'left-1'}`}></div>
                </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                <div className="flex flex-col">
                  <span className="text-slate-200 font-medium">Auditory Alarm</span>
                  <span className="text-xs text-slate-400">Play sound on alert</span>
                </div>
                <button 
                  onClick={() => setAlertSettings(prev => ({...prev, soundEnabled: !prev.soundEnabled}))}
                  className={`p-2 rounded-lg transition-colors ${alertSettings.soundEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-600 text-slate-400'}`}
                >
                  {alertSettings.soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-700 flex justify-end">
              <button 
                onClick={() => setShowSettings(false)}
                className="bg-slate-200 hover:bg-white text-slate-900 font-bold py-2 px-6 rounded-lg transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Feed Section */}
      <div className="flex flex-col gap-4">
        <div className={`relative rounded-xl overflow-hidden bg-black border-2 shadow-2xl aspect-video transition-colors duration-500 ${isAlertActive ? 'border-red-500 shadow-red-900/50' : 'border-slate-700'}`}>
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            className="w-full h-full object-fill" 
            videoConstraints={{ facingMode: "environment", aspectRatio: 1.777777778 }}
          />
          
          {/* Detected Hazard Bounding Boxes */}
          {lastAnalysis && lastAnalysis.hazards.map((hazard, idx) => {
             // Skip if no box data
             if (!hazard.box_2d || hazard.box_2d.length !== 4) return null;
             
             const [ymin, xmin, ymax, xmax] = hazard.box_2d;
             
             // Styling based on severity
             const borderColor = hazard.severity === 'HIGH' ? 'border-red-500' : 
                                 hazard.severity === 'MEDIUM' ? 'border-orange-500' : 'border-blue-400';
             const bgColor = hazard.severity === 'HIGH' ? 'bg-red-500/10' : 
                             hazard.severity === 'MEDIUM' ? 'bg-orange-500/10' : 'bg-blue-400/10';
             const labelBg = hazard.severity === 'HIGH' ? 'bg-red-600' : 
                             hazard.severity === 'MEDIUM' ? 'bg-orange-600' : 'bg-blue-500';

             return (
               <div
                 key={idx}
                 className={`absolute z-20 border-2 ${borderColor} ${bgColor} transition-all duration-300`}
                 style={{
                   top: `${ymin / 10}%`,
                   left: `${xmin / 10}%`,
                   height: `${(ymax - ymin) / 10}%`,
                   width: `${(xmax - xmin) / 10}%`,
                 }}
               >
                 <span className={`absolute -top-6 left-0 text-[10px] font-bold text-white px-2 py-0.5 rounded shadow-sm ${labelBg} whitespace-nowrap`}>
                   {hazard.type}
                 </span>
               </div>
             );
          })}

          {/* HUD Hazard List - New Feature */}
          {lastAnalysis && lastAnalysis.hazards.length > 0 && (
            <div className="absolute top-14 right-4 bottom-4 z-20 w-72 flex flex-col gap-2 pointer-events-none overflow-y-auto no-scrollbar mask-gradient-bottom">
              {lastAnalysis.hazards.map((hazard, idx) => (
                <div 
                  key={`hud-${idx}`} 
                  className={`backdrop-blur-md bg-slate-900/80 p-3 rounded-lg border-l-4 shadow-xl transform transition-all duration-500 ease-out translate-x-0 opacity-100 ${
                    hazard.severity === 'HIGH' ? 'border-red-500 shadow-red-900/20' :
                    hazard.severity === 'MEDIUM' ? 'border-orange-500 shadow-orange-900/20' : 'border-blue-500 shadow-blue-900/20'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-white text-sm drop-shadow-md">{hazard.type}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm ${
                       hazard.severity === 'HIGH' ? 'bg-red-600 text-white' : 
                       hazard.severity === 'MEDIUM' ? 'bg-orange-500 text-black' : 'bg-blue-600 text-white'
                    }`}>
                      {hazard.severity}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 rtl-text leading-relaxed drop-shadow-sm">
                    {hazard.description}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Overlay Status */}
          <div className="absolute top-4 left-4 flex items-center gap-2 z-30">
            <span className={`animate-pulse w-3 h-3 rounded-full ${isMonitoring ? 'bg-red-500' : 'bg-gray-500'}`}></span>
            <span className="text-xs font-mono font-bold bg-black/60 px-2 py-1 rounded text-white">
              {isMonitoring ? "LIVE FEED ACTIVE" : "FEED PAUSED"}
            </span>
          </div>

          {isAnalyzing && (
            <div className="absolute top-4 right-4 flex items-center gap-2 z-30">
               <div className="bg-black/60 px-2 py-1 rounded text-white text-xs font-mono flex items-center gap-2">
                 <div className="w-2 h-2 bg-blue-400 rounded-full animate-ping"></div>
                 PROCESSING
               </div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => setShowSettings(true)}
            className="w-14 h-14 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-600 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Configure Thresholds"
          >
            <Settings className="w-6 h-6" />
          </button>
          <button
            onClick={toggleMonitoring}
            className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-lg font-bold text-lg transition-colors ${
              isMonitoring 
                ? 'bg-red-900/50 text-red-200 border border-red-700 hover:bg-red-900' 
                : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/20'
            }`}
          >
            {isMonitoring ? <><Pause /> Stop Monitoring</> : <><Play /> Start AI Supervisor</>}
          </button>
        </div>
      </div>

      {/* Real-time Analysis Result */}
      <div className={`bg-slate-800 rounded-xl p-6 border flex flex-col h-full overflow-hidden relative transition-colors ${isAlertActive ? 'border-red-500 bg-red-950/20' : 'border-slate-700'}`}>
         {!lastAnalysis ? (
           <div className="flex flex-col items-center justify-center h-full text-slate-500">
             <CameraOff className="w-16 h-16 mb-4 opacity-50" />
             <p>Start monitoring to receive AI insights</p>
           </div>
         ) : (
           <div className="flex flex-col h-full animate-fadeIn">
             <div className="flex justify-between items-start mb-6 border-b border-slate-700 pb-4">
                <div>
                  <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-1">Safety Score</h2>
                  <div className={`text-4xl font-black ${
                    lastAnalysis.safetyScore < alertSettings.minSafetyScore ? 'text-red-500 animate-pulse' :
                    lastAnalysis.safetyScore > 80 ? 'text-emerald-400' : 
                    lastAnalysis.safetyScore > 50 ? 'text-amber-400' : 'text-red-500'
                  }`}>
                    {lastAnalysis.safetyScore}/100
                  </div>
                </div>
                <div className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  lastAnalysis.isSafe ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800' : 'bg-red-900/30 text-red-400 border border-red-800'
                }`}>
                  {lastAnalysis.isSafe ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                  <span className="font-bold">{lastAnalysis.isSafe ? "Environment Safe" : "Hazards Detected"}</span>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
               <div className="mb-6">
                 <h3 className="text-xs uppercase text-slate-500 font-bold mb-2">AI Summary (Persian)</h3>
                 <p className="rtl-text text-lg text-slate-200 leading-relaxed bg-slate-700/50 p-3 rounded-lg border-r-4 border-blue-500">
                   {lastAnalysis.summary}
                 </p>
               </div>

               <div className="space-y-3">
                 <h3 className="text-xs uppercase text-slate-500 font-bold mb-2 flex items-center gap-2">
                   <List className="w-4 h-4" /> Detected Hazards List
                 </h3>
                 {lastAnalysis.hazards.length === 0 ? (
                   <div className="text-center py-8 text-slate-500 bg-slate-800/50 rounded-lg border border-dashed border-slate-700">
                     No immediate hazards detected by AI.
                   </div>
                 ) : (
                   lastAnalysis.hazards.map((hazard, idx) => (
                     <div key={idx} className={`p-4 rounded-lg border-l-4 ${
                       hazard.severity === 'HIGH' ? 'bg-red-900/20 border-red-500' :
                       hazard.severity === 'MEDIUM' ? 'bg-amber-900/20 border-amber-500' :
                       'bg-blue-900/20 border-blue-500'
                     }`}>
                       <div className="flex justify-between items-center mb-2">
                         <span className="font-bold text-slate-200">{hazard.type}</span>
                         <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                           hazard.severity === 'HIGH' ? 'bg-red-500 text-white' : 'bg-amber-500 text-black'
                         }`}>{hazard.severity}</span>
                       </div>
                       <p className="rtl-text text-sm text-slate-300 mb-2">{hazard.description}</p>
                       <div className="rtl-text text-sm font-semibold text-emerald-400 bg-emerald-900/10 p-2 rounded">
                         💡 {hazard.recommendation}
                       </div>
                     </div>
                   ))
                 )}
               </div>
             </div>
             
             <div className="mt-4 pt-4 border-t border-slate-700 text-xs text-slate-500 flex justify-between">
               <div className="flex flex-col sm:flex-row sm:gap-4">
                 <span>AI Model: Gemini 2.5 Flash</span>
                 {latency > 0 && (
                   <span className="font-mono text-slate-400 flex items-center gap-1">
                     <Zap className="w-3 h-3 text-yellow-500" />
                     Latency: <span className={latency > 2000 ? "text-orange-400" : "text-emerald-400"}>{latency}ms</span>
                   </span>
                 )}
               </div>
               <span>Last Update: {lastAnalysis.timestamp}</span>
             </div>
           </div>
         )}
      </div>
    </div>
  );
};

export default Monitor;