
import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, AlertTriangle, CheckCircle, Pause, Play, Settings, Bell, X, Video, BrainCircuit, TrendingUp, ChevronDown, Smartphone, MessageSquare, Grid, Check, Monitor as MonitorIcon, Eye, RefreshCw, Clock } from 'lucide-react';
import { analyzeSafetyImage } from '../services/geminiService';
import { SafetyAnalysis, LogEntry, Hazard } from '../types';

interface MonitorProps {
  onNewAnalysis: (analysis: LogEntry) => void;
}

type SeverityTrigger = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

interface AlertSettings {
  minSafetyScore: number;
  minSeverityTrigger: SeverityTrigger;
  soundEnabled: boolean;
  smsEnabled: boolean;
  phoneNumber: string;
  categoryThresholds: Record<string, number>;
}

interface Prediction {
  hazardType: string;
  probability: number;
  reasoning: string;
}

const Monitor: React.FC<MonitorProps> = ({ onNewAnalysis }) => {
  const webcamRefs = useRef<{ [key: string]: Webcam | null }>({});
  
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentAnalysisCameraId, setCurrentAnalysisCameraId] = useState<string | null>(null);
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [isSmartMode, setIsSmartMode] = useState(true);
  const [cameraLastCheckTime, setCameraLastCheckTime] = useState<Record<string, number>>({});
  const [cameraLastAlertTime, setCameraLastAlertTime] = useState<Record<string, number>>({});
  const [cameraHazardLevel, setCameraHazardLevel] = useState<Record<string, number>>({});
  const [cameraAnalyses, setCameraAnalyses] = useState<Record<string, SafetyAnalysis>>({});
  const [intervalId, setIntervalId] = useState<ReturnType<typeof setInterval> | null>(null);
  const [latency, setLatency] = useState<number>(0);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceIds, setActiveDeviceIds] = useState<string[]>([]);
  const [showCameraSelector, setShowCameraSelector] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [isSilenced, setIsSilenced] = useState(false);
  const [smsNotification, setSmsNotification] = useState<string | null>(null);

  const [alertSettings, setAlertSettings] = useState<AlertSettings>({
    minSafetyScore: 60,
    minSeverityTrigger: 'HIGH',
    soundEnabled: true,
    smsEnabled: false,
    phoneNumber: '',
    categoryThresholds: {
      'PPE': 60, 'MACHINERY': 70, 'HOUSEKEEPING': 50, 'FIRE': 60, 'BEHAVIOR': 50, 'OTHER': 50
    }
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const lastSmsTimeRef = useRef<number>(0);

  // Load Labels
  useEffect(() => {
    const saved = localStorage.getItem('hse_camera_labels');
    if (saved) setCustomLabels(JSON.parse(saved));
  }, []);

  const updateLabel = (deviceId: string, name: string) => {
    const updated = { ...customLabels, [deviceId]: name };
    if (!name.trim()) delete updated[deviceId];
    setCustomLabels(updated);
    localStorage.setItem('hse_camera_labels', JSON.stringify(updated));
  };

  const getDeviceName = useCallback((deviceId: string) => {
    if (customLabels[deviceId]) return customLabels[deviceId];
    const device = devices.find(d => d.deviceId === deviceId);
    return device?.label || `Camera ${deviceId.slice(0, 5)}...`;
  }, [customLabels, devices]);

  // Robust Device Enumeration
  useEffect(() => {
    const getDevices = async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const videoDevs = devs.filter(d => d.kind === 'videoinput');
        setDevices(videoDevs);
        if (videoDevs.length > 0 && activeDeviceIds.length === 0) {
          setActiveDeviceIds([videoDevs[0].deviceId]);
        }
      } catch (e) {
        console.warn("Camera enumeration failed (Desktop permission?)", e);
      }
    };
    getDevices();
  }, [activeDeviceIds.length]);

  // --- Alert Logic ---
  const startAlarm = useCallback(() => {
    if (!alertSettings.soundEnabled || oscillatorRef.current) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      oscillatorRef.current = osc;
    } catch (e) {}
  }, [alertSettings.soundEnabled]);

  const stopAlarm = useCallback(() => {
    if (oscillatorRef.current) {
      try { oscillatorRef.current.stop(); oscillatorRef.current.disconnect(); } catch (e) {}
      oscillatorRef.current = null;
    }
  }, []);

  const checkAlerts = useCallback((analysis: SafetyAnalysis, deviceId: string) => {
    let shouldTrigger = false;
    let maxSeverity = 0;
    const severityMap: Record<string, number> = { 'SAFE': 0, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };

    analysis.hazards.forEach(h => {
        const sev = severityMap[h.severity] || 0;
        if (sev > maxSeverity) maxSeverity = sev;
    });

    setCameraHazardLevel(prev => ({ ...prev, [deviceId]: maxSeverity }));
    if (maxSeverity === 3) setCameraLastAlertTime(prev => ({ ...prev, [deviceId]: Date.now() }));

    if (analysis.safetyScore < alertSettings.minSafetyScore) shouldTrigger = true;
    
    const triggerThresholds: Record<SeverityTrigger, number> = { 'OFF': 99, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };
    if (maxSeverity >= triggerThresholds[alertSettings.minSeverityTrigger]) shouldTrigger = true;

    if (shouldTrigger && !isAlertActive && !isSilenced) {
      setIsAlertActive(true);
      startAlarm();
    }
  }, [alertSettings, isAlertActive, isSilenced, startAlarm]);

  // --- Smart Camera Selection ---
  const getNextSmartCamera = useCallback((): string => {
    if (activeDeviceIds.length === 0) return '';
    if (activeDeviceIds.length === 1) return activeDeviceIds[0];

    const now = Date.now();
    let bestCandidate = activeDeviceIds[0];
    let maxPriority = -1;

    activeDeviceIds.forEach(id => {
        const lastCheck = cameraLastCheckTime[id] || 0;
        const secondsSinceCheck = (now - lastCheck) / 1000;
        const hazardWeight = (cameraHazardLevel[id] || 0) * 40;
        const lastAlert = cameraLastAlertTime[id] || 0;
        const secondsSinceAlert = (now - lastAlert) / 1000;
        let retentionWeight = 0;
        if (secondsSinceAlert < 90) retentionWeight = (90 - secondsSinceAlert) * 2.0; 
        const priority = secondsSinceCheck + hazardWeight + retentionWeight;

        if (priority > maxPriority) {
            maxPriority = priority;
            bestCandidate = id;
        }
    });
    return bestCandidate;
  }, [activeDeviceIds, cameraLastCheckTime, cameraHazardLevel, cameraLastAlertTime]);

  const captureAndAnalyze = useCallback(async () => {
    if (activeDeviceIds.length === 0 || isAnalyzing) return;

    const deviceId = getNextSmartCamera();
    const webcam = webcamRefs.current[deviceId];

    if (webcam) {
      const imageSrc = webcam.getScreenshot();
      if (imageSrc) {
        setIsAnalyzing(true);
        setCurrentAnalysisCameraId(deviceId);
        const base64Data = imageSrc.split(',')[1];
        
        try {
          const startTime = performance.now();
          const result = await analyzeSafetyImage(base64Data);
          setLatency(Math.round(performance.now() - startTime));

          // If timeout occurred (score -1), ignore
          if (result.safetyScore === -1) {
              setCameraLastCheckTime(prev => ({ ...prev, [deviceId]: Date.now() }));
              return;
          }

          const filteredHazards = result.hazards.filter(h => {
             const threshold = alertSettings.categoryThresholds[h.category] || 50;
             const conf = h.confidence !== undefined ? h.confidence : 100; 
             return conf >= threshold;
          });

          const isSafe = filteredHazards.length === 0 && result.safetyScore > 80;
          const filteredResult: SafetyAnalysis = { ...result, hazards: filteredHazards, isSafe };

          setCameraAnalyses(prev => ({ ...prev, [deviceId]: filteredResult }));
          setCameraLastCheckTime(prev => ({ ...prev, [deviceId]: Date.now() }));
          checkAlerts(filteredResult, deviceId);
          onNewAnalysis({ id: Date.now().toString(), ...filteredResult, thumbnail: imageSrc, cameraLabel: getDeviceName(deviceId) });

        } catch (e) {
          console.error("Analysis Error", e);
        } finally {
          setIsAnalyzing(false);
        }
      }
    }
  }, [isAnalyzing, onNewAnalysis, checkAlerts, activeDeviceIds, alertSettings.categoryThresholds, getNextSmartCamera, getDeviceName]);

  const toggleMonitoring = () => {
    if (isMonitoring) {
      if (intervalId) clearInterval(intervalId);
      setIsMonitoring(false);
      setIsAnalyzing(false);
      setIsSilenced(false);
      stopAlarm();
    } else {
      setIsMonitoring(true);
      captureAndAnalyze(); 
      const id = setInterval(captureAndAnalyze, activeDeviceIds.length > 1 ? 5000 : 8000); 
      setIntervalId(id);
    }
  };

  useEffect(() => {
    return () => {
      if (intervalId) clearInterval(intervalId);
      stopAlarm();
    };
  }, [intervalId, stopAlarm]);

  const toggleCamera = (deviceId: string) => {
    setActiveDeviceIds(prev => prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId]);
  };

  const activeAnalysis = currentAnalysisCameraId ? cameraAnalyses[currentAnalysisCameraId] : Object.values(cameraAnalyses)[0] || null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full relative">
      {smsNotification && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-bounce">
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 border border-white/20">
             <Smartphone className="w-4 h-4" /> <span>{smsNotification}</span>
          </div>
        </div>
      )}

      {isAlertActive && (
        <div className="absolute inset-0 z-50 bg-red-500/20 backdrop-blur-sm flex items-center justify-center animate-pulse rounded-xl border-4 border-red-600 pointer-events-none">
           <div className="bg-slate-900 border-2 border-red-500 p-8 rounded-2xl shadow-2xl flex flex-col items-center pointer-events-auto">
             <AlertTriangle className="w-20 h-20 text-red-500 mb-4 animate-bounce" />
             <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-widest">Critical Alert</h2>
             <button onClick={() => { setIsAlertActive(false); stopAlarm(); setIsSilenced(true); }} className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full shadow-lg">
               <Bell className="w-5 h-5 inline mr-2" /> Silence Alarm
             </button>
           </div>
        </div>
      )}

      {showSettings && (
        <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">Settings</h3>
              <button onClick={() => setShowSettings(false)}><X className="w-6 h-6 text-slate-400" /></button>
            </div>
            {/* Simplified Settings UI for brevity in this update - Full logic retained in state */}
            <div className="space-y-4">
               <div>
                 <label className="text-white text-sm">Safety Threshold: {alertSettings.minSafetyScore}</label>
                 <input type="range" className="w-full" min="0" max="100" value={alertSettings.minSafetyScore} onChange={e => setAlertSettings(p => ({...p, minSafetyScore: +e.target.value}))} />
               </div>
               <div className="bg-slate-700 p-3 rounded">
                 <label className="flex items-center gap-2 text-white text-sm">
                   <input type="checkbox" checked={alertSettings.soundEnabled} onChange={e => setAlertSettings(p => ({...p, soundEnabled: e.target.checked}))} />
                   Enable Audio Alarm
                 </label>
               </div>
               <button onClick={() => setShowSettings(false)} className="w-full bg-blue-600 py-2 rounded text-white font-bold">Save</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Enforce 16:9 Aspect Ratio to match Webcam default mostly, helps alignment */}
        <div className={`relative bg-black border-2 rounded-xl overflow-hidden shadow-2xl aspect-video transition-colors duration-500 flex flex-col ${isAlertActive ? 'border-red-500 shadow-red-900/50' : 'border-slate-700'}`}>
          <div className={`w-full h-full grid ${activeDeviceIds.length <= 1 ? 'grid-cols-1' : activeDeviceIds.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'} bg-black`}>
            {activeDeviceIds.map((deviceId) => {
               const camAnalysis = cameraAnalyses[deviceId];
               const hasHazard = camAnalysis && !camAnalysis.isSafe;
               
               return (
                 <div key={deviceId} className="relative w-full h-full border border-slate-800 overflow-hidden group bg-black">
                   <Webcam
                      audio={false}
                      ref={(el) => { if (webcamRefs.current) webcamRefs.current[deviceId] = el; }}
                      screenshotFormat="image/jpeg"
                      className="w-full h-full object-cover" // Ensure it fills the grid cell
                      videoConstraints={{ deviceId: deviceId, aspectRatio: 1.777 }} // Request 16:9
                      onUserMediaError={(e) => console.error("Webcam Error", e)}
                   />
                   
                   <div className="absolute top-2 left-2 flex flex-col gap-1 z-20">
                      <div className={`px-2 py-1 rounded text-[10px] font-bold text-white shadow-md backdrop-blur-md ${hasHazard ? 'bg-red-600/80' : 'bg-slate-800/60'}`}>
                          {getDeviceName(deviceId).slice(0, 15)}
                      </div>
                      {currentAnalysisCameraId === deviceId && isAnalyzing && (
                          <div className="flex items-center gap-1 bg-blue-600/80 text-white text-[10px] px-2 py-1 rounded animate-pulse">
                             <Eye className="w-3 h-3" /> AI
                          </div>
                      )}
                   </div>

                   {camAnalysis && camAnalysis.hazards.map((hazard, idx) => {
                      if (!hazard.box_2d) return null;
                      const [ymin, xmin, ymax, xmax] = hazard.box_2d;
                      const isHigh = hazard.severity === 'HIGH';
                      
                      return (
                         <div key={`haz-${idx}`} 
                           className={`absolute z-10 border-2 ${isHigh ? 'border-red-500 bg-red-500/20' : 'border-yellow-400 bg-yellow-400/10'}`}
                           style={{ 
                             // Normalized coordinates 0-1000 to Percentage
                             top: `${ymin/10}%`, 
                             left: `${xmin/10}%`, 
                             height: `${(ymax-ymin)/10}%`, 
                             width: `${(xmax-xmin)/10}%` 
                           }}
                         >
                           <span className={`absolute -top-5 left-0 text-[9px] font-bold text-white px-1 rounded ${isHigh ? 'bg-red-600' : 'bg-yellow-600'}`}>
                               {hazard.type}
                           </span>
                         </div>
                      )
                   })}
                 </div>
               )
            })}
          </div>

          <div className="absolute bottom-4 left-4 flex flex-col gap-1 z-30 pointer-events-none">
            <div className="flex items-center gap-2">
                <span className={`animate-pulse w-3 h-3 rounded-full ${isMonitoring ? 'bg-red-500' : 'bg-gray-500'}`}></span>
                <span className="text-xs font-mono font-bold bg-black/60 px-2 py-1 rounded text-white">
                  {isMonitoring ? (activeDeviceIds.length > 1 ? "MULTI-CAM ACTIVE" : "LIVE FEED") : "PAUSED"}
                </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg flex items-center gap-3 shadow-sm relative">
            <div className="bg-slate-700 p-1.5 rounded text-slate-300">
               {activeDeviceIds.length > 1 ? <Grid className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
            </div>
            <div className="flex-1">
               <button 
                  onClick={() => setShowCameraSelector(!showCameraSelector)}
                  className="flex items-center justify-between w-full text-left bg-slate-900/50 hover:bg-slate-900 p-2 rounded text-slate-200 text-xs font-bold transition-colors"
               >
                 <span>{activeDeviceIds.length === 0 ? "Select Camera" : `${activeDeviceIds.length} Cameras`}</span>
                 <ChevronDown className="w-4 h-4 text-slate-400" />
               </button>

               {showCameraSelector && (
                 <div className="absolute bottom-full left-0 w-full bg-slate-800 border border-slate-600 rounded-lg shadow-2xl mb-2 p-2 z-50 animate-fadeIn">
                   {devices.length === 0 && <div className="text-xs text-red-400 p-2">No cameras found. Check permissions.</div>}
                   {devices.map((device) => (
                     <div key={device.deviceId} onClick={() => toggleCamera(device.deviceId)} className={`flex items-center gap-2 p-2 rounded cursor-pointer ${activeDeviceIds.includes(device.deviceId) ? 'bg-blue-600/20' : 'hover:bg-slate-700'}`}>
                       <div className={`w-3 h-3 border ${activeDeviceIds.includes(device.deviceId) ? 'bg-blue-500' : ''}`}></div>
                       <span className="text-xs text-white">{device.label || `Camera ${device.deviceId.slice(0,5)}`}</span>
                     </div>
                   ))}
                 </div>
               )}
            </div>
            
            <button onClick={toggleMonitoring} className={`px-4 py-2 rounded-lg font-bold text-sm ${isMonitoring ? 'bg-red-900 text-red-200' : 'bg-emerald-600 text-white'}`}>
              {isMonitoring ? "Stop" : "Start AI"}
            </button>
            
            <button onClick={() => setShowSettings(true)} className="p-2 bg-slate-700 rounded-lg text-slate-300"><Settings className="w-5 h-5" /></button>
        </div>
      </div>

      <div className={`bg-slate-800 rounded-xl p-6 border flex flex-col h-full overflow-hidden relative transition-colors ${isAlertActive ? 'border-red-500 bg-red-950/20' : 'border-slate-700'}`}>
         {!activeAnalysis ? (
           <div className="flex flex-col items-center justify-center h-full text-slate-500">
             <MonitorIcon className="w-16 h-16 mb-4 opacity-50" />
             <p>Ready to analyze</p>
           </div>
         ) : (
           <div className="flex flex-col h-full animate-fadeIn">
             <div className="flex justify-between items-start mb-6 border-b border-slate-700 pb-4">
                <div>
                  <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-1">Safety Score</h2>
                  <div className={`text-4xl font-black ${activeAnalysis.safetyScore < 80 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {activeAnalysis.safetyScore > 0 ? activeAnalysis.safetyScore : '--'}
                  </div>
                </div>
             </div>

             <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
               <div className="mb-6">
                 <h3 className="text-xs uppercase text-slate-500 font-bold mb-2">Summary</h3>
                 <p className="rtl-text text-lg text-slate-200 leading-relaxed bg-slate-700/50 p-3 rounded-lg border-r-4 border-blue-500">
                   {activeAnalysis.summary}
                 </p>
               </div>
               
               <div className="space-y-3">
                 {activeAnalysis.hazards.map((hazard, idx) => (
                   <div key={idx} className={`p-4 rounded-lg border-l-4 shadow-md ${hazard.severity === 'HIGH' ? 'bg-red-900/20 border-red-500' : 'bg-slate-700/30 border-blue-500'}`}>
                     <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-slate-200">{hazard.type}</span>
                        <span className="text-[10px] uppercase bg-slate-900 px-2 py-1 rounded">{hazard.severity}</span>
                     </div>
                     <p className="rtl-text text-sm text-slate-300">{hazard.description}</p>
                   </div>
                 ))}
               </div>
             </div>
             <div className="mt-4 pt-4 border-t border-slate-700 text-xs text-slate-500 flex justify-between">
               <span>Gemini 2.5 Flash Preview</span>
               <span className="font-mono text-emerald-400">{latency}ms</span>
             </div>
           </div>
         )}
      </div>
    </div>
  );
};

export default Monitor;
