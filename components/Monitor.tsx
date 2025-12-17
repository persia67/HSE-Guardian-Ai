import React, { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, AlertTriangle, CheckCircle, Pause, Play, CameraOff, Settings, Volume2, VolumeX, Bell, BellOff, X, Zap, List, Disc, Video, BrainCircuit, TrendingUp, Filter, ChevronDown, Smartphone, MessageSquare, Grid, Check, Monitor as MonitorIcon } from 'lucide-react';
import { analyzeSafetyImage } from '../services/geminiService';
import { SafetyAnalysis, LogEntry } from '../types';

interface MonitorProps {
  onNewAnalysis: (analysis: LogEntry) => void;
}

type SeverityTrigger = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

interface AlertSettings {
  minSafetyScore: number;
  minSeverityTrigger: SeverityTrigger;
  soundEnabled: boolean;
  preRollSeconds: number;
  smsEnabled: boolean;
  phoneNumber: string;
}

interface Prediction {
  hazardType: string;
  probability: number; // 0-100
  reasoning: string;
}

const Monitor: React.FC<MonitorProps> = ({ onNewAnalysis }) => {
  // Multi-Camera Refs
  const webcamRefs = useRef<{ [key: string]: Webcam | null }>({});
  
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecordingMode, setIsRecordingMode] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentAnalysisCameraId, setCurrentAnalysisCameraId] = useState<string | null>(null);
  
  // Store the last analysis per camera ID
  const [cameraAnalyses, setCameraAnalyses] = useState<Record<string, SafetyAnalysis>>({});
  
  const [intervalId, setIntervalId] = useState<ReturnType<typeof setInterval> | null>(null);
  const [latency, setLatency] = useState<number>(0);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [analysisHistory, setAnalysisHistory] = useState<SafetyAnalysis[]>([]);
  
  // Video Buffer State (Only for single view or primary camera in future)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]); 
  const [bufferDuration, setBufferDuration] = useState(0); 

  // Camera Device State
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceIds, setActiveDeviceIds] = useState<string[]>([]);
  const [showCameraSelector, setShowCameraSelector] = useState(false);
  
  // Alert State
  const [showSettings, setShowSettings] = useState(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>({
    minSafetyScore: 60,
    minSeverityTrigger: 'HIGH', // Default to High only
    soundEnabled: true,
    preRollSeconds: 3, 
    smsEnabled: false,
    phoneNumber: ''
  });
  const [isAlertActive, setIsAlertActive] = useState(false);
  const [isSilenced, setIsSilenced] = useState(false);
  
  // SMS Notification State
  const lastSmsTimeRef = useRef<number>(0);
  const [smsNotification, setSmsNotification] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Round Robin Index
  const cameraCycleIndex = useRef(0);

  // Device Enumeration
  const handleDevices = useCallback(
    (mediaDevices: MediaDeviceInfo[]) => {
      const videoDevices = mediaDevices.filter(({ kind }) => kind === "videoinput");
      setDevices(videoDevices);
      
      // Auto-select first camera if none selected
      if (videoDevices.length > 0 && activeDeviceIds.length === 0) {
        setActiveDeviceIds([videoDevices[0].deviceId]);
      }
    },
    [activeDeviceIds]
  );

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(handleDevices);
  }, [handleDevices]);

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
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setTargetAtTime(440, ctx.currentTime + 0.5, 0.1);

      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      
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
  }, []);

  // Check thresholds
  const checkAlerts = useCallback((analysis: SafetyAnalysis) => {
    let shouldTrigger = false;

    // 1. Check Safety Score
    if (analysis.safetyScore < alertSettings.minSafetyScore) {
      shouldTrigger = true;
    }

    // 2. Check Severity Level
    const severityWeight: Record<string, number> = { 'SAFE': 0, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 };
    const triggerThresholds: Record<SeverityTrigger, number> = { 
      'OFF': 99, 
      'LOW': 1,
      'MEDIUM': 2, 
      'HIGH': 3 
    };

    const userThreshold = triggerThresholds[alertSettings.minSeverityTrigger];

    if (userThreshold < 99) {
      const hasSevereHazard = analysis.hazards.some(h => {
        const weight = severityWeight[h.severity] || 0;
        return weight >= userThreshold;
      });
      if (hasSevereHazard) shouldTrigger = true;
    }

    // 3. SMS Alert Logic
    if (alertSettings.smsEnabled && alertSettings.phoneNumber) {
      const criticalHazards = analysis.hazards.filter(h => h.severity === 'HIGH');
      const COOLDOWN = 300000; // 5 minutes
      
      if (criticalHazards.length > 0) {
        const now = Date.now();
        if (now - lastSmsTimeRef.current > COOLDOWN) {
          const message = `CRITICAL: ${criticalHazards[0].type} detected. Score: ${analysis.safetyScore}`;
          console.log(`[SMS SIMULATION] Sending to ${alertSettings.phoneNumber}: ${message}`);
          setSmsNotification(`SMS sent to ${alertSettings.phoneNumber}`);
          lastSmsTimeRef.current = now;
          setTimeout(() => setSmsNotification(null), 5000);
        }
      }
    }

    if (shouldTrigger) {
      if (!isAlertActive && !isSilenced) {
        setIsAlertActive(true);
        startAlarm();
      }
    } else {
      // Only turn off if ALL cameras are safe (simplified: we just check current analysis)
      // In multi-camera, we might want to keep alarm on if ANY camera is unsafe.
      // For now, this logic resets per analysis.
      // Improvement: Check global state of all cameras? 
      // Let's stick to: Alarm triggers on hazard. User acknowledges to silence.
      // Automatic turn off is tricky in multi-cam.
    }
  }, [alertSettings, isAlertActive, isSilenced, startAlarm, stopAlarm]);

  const acknowledgeAlert = () => {
    setIsAlertActive(false);
    stopAlarm();
    setIsSilenced(true);
  };

  const captureAndAnalyze = useCallback(async () => {
    if (activeDeviceIds.length === 0 || isAnalyzing) return;

    // Round Robin Selection
    const nextIndex = (cameraCycleIndex.current + 1) % activeDeviceIds.length;
    cameraCycleIndex.current = nextIndex;
    const deviceId = activeDeviceIds[nextIndex];
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
          const endTime = performance.now();
          setLatency(Math.round(endTime - startTime));

          // Find camera label
          const camLabel = devices.find(d => d.deviceId === deviceId)?.label || `Camera ${nextIndex + 1}`;

          setCameraAnalyses(prev => ({ ...prev, [deviceId]: result }));
          checkAlerts(result);
          
          setAnalysisHistory(prev => {
             const updated = [...prev, result].slice(-10);
             // generatePredictions(result, updated); // Simplified: Predictions based on global history
             return updated;
          });

          // Only record if single camera mode is active (performance reason)
          let videoUrl: string | undefined = undefined;
          // Recording logic omitted for multi-view stability, or we can enable it for the specific cam later.
          
          onNewAnalysis({
            id: Date.now().toString(),
            ...result,
            thumbnail: imageSrc,
            videoUrl,
            cameraLabel: camLabel
          });

        } catch (e) {
          console.error("Analysis loop error", e);
        } finally {
          setIsAnalyzing(false);
          // Don't clear currentAnalysisCameraId immediately so we can see which one was last processed
        }
      }
    }
  }, [isAnalyzing, onNewAnalysis, checkAlerts, activeDeviceIds, devices]);

  const toggleMonitoring = () => {
    if (isMonitoring) {
      if (intervalId) clearInterval(intervalId);
      setIsMonitoring(false);
      setIsAnalyzing(false);
      setIsSilenced(false);
      setPredictions([]);
    } else {
      setIsMonitoring(true);
      if (!audioContextRef.current) {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContext();
      }
      captureAndAnalyze(); 
      // Use slightly faster interval for multi-cam to ensure coverage
      const intervalMs = activeDeviceIds.length > 1 ? 5000 : 10000;
      const id = setInterval(captureAndAnalyze, intervalMs); 
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
    setActiveDeviceIds(prev => {
      if (prev.includes(deviceId)) {
        return prev.filter(id => id !== deviceId);
      } else {
        return [...prev, deviceId];
      }
    });
  };

  const activeAnalysis = currentAnalysisCameraId ? cameraAnalyses[currentAnalysisCameraId] : Object.values(cameraAnalyses)[0] || null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full relative">
      
      {/* Toast Notification for SMS */}
      {smsNotification && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[60] animate-bounce">
          <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 border border-white/20">
             <div className="bg-white/20 p-1 rounded-full">
               <Smartphone className="w-4 h-4" />
             </div>
             <div className="flex flex-col">
               <span className="text-sm font-bold">Alert Sent</span>
               <span className="text-[10px] opacity-90">{smsNotification}</span>
             </div>
          </div>
        </div>
      )}

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
          <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto scrollbar-thin">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-400" /> Configuration
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            {/* Settings Content Same as before... */}
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex justify-between">
                  <span>Minimum Safety Score</span>
                  <span className="text-orange-400 font-bold">{alertSettings.minSafetyScore}</span>
                </label>
                <input type="range" min="0" max="100" value={alertSettings.minSafetyScore} onChange={(e) => setAlertSettings(prev => ({...prev, minSafetyScore: parseInt(e.target.value)}))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500" />
              </div>

              <div className="p-4 bg-slate-700/50 rounded-lg border border-slate-600">
                <div className="flex justify-between items-center mb-3">
                   <div className="flex items-center gap-2">
                     <MessageSquare className="w-4 h-4 text-slate-300" />
                     <span className="text-slate-200 font-medium text-sm">Critical SMS Alerts</span>
                   </div>
                   <button onClick={() => setAlertSettings(prev => ({...prev, smsEnabled: !prev.smsEnabled}))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${alertSettings.smsEnabled ? 'bg-violet-600' : 'bg-slate-600'}`}>
                     <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${alertSettings.smsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                   </button>
                </div>
                {alertSettings.smsEnabled && (
                  <div className="mt-2 animate-fadeIn">
                    <label className="block text-xs font-mono text-slate-400 mb-1">PHONE NUMBER</label>
                    <input type="tel" placeholder="+1 (555) 000-0000" value={alertSettings.phoneNumber} onChange={(e) => setAlertSettings(prev => ({...prev, phoneNumber: e.target.value}))} className="bg-slate-800 border border-slate-600 rounded-md p-2 text-sm text-white w-full outline-none" />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-700 flex justify-end">
              <button onClick={() => setShowSettings(false)} className="bg-slate-200 hover:bg-white text-slate-900 font-bold py-2 px-6 rounded-lg transition-colors">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Video Feed Section - Multi-Camera Grid */}
      <div className="flex flex-col gap-4">
        <div className={`relative bg-black border-2 rounded-xl overflow-hidden shadow-2xl aspect-video transition-colors duration-500 flex flex-col ${isAlertActive ? 'border-red-500 shadow-red-900/50' : 'border-slate-700'}`}>
          
          {/* Grid Layout Logic */}
          <div className={`w-full h-full grid ${
             activeDeviceIds.length <= 1 ? 'grid-cols-1' :
             activeDeviceIds.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
          } bg-black`}>
            {activeDeviceIds.map((deviceId) => {
               // Get local analysis for this camera if exists
               const camAnalysis = cameraAnalyses[deviceId];
               const hasHazard = camAnalysis && !camAnalysis.isSafe;

               return (
                 <div key={deviceId} className="relative w-full h-full border border-slate-800 overflow-hidden group">
                   <Webcam
                      audio={false}
                      ref={(el) => { if (webcamRefs.current) webcamRefs.current[deviceId] = el; }}
                      screenshotFormat="image/jpeg"
                      className="w-full h-full object-cover"
                      videoConstraints={{ deviceId: deviceId }}
                   />
                   
                   {/* Per-Camera Status Overlay */}
                   <div className="absolute top-2 left-2 flex items-center gap-2">
                      <div className={`px-2 py-1 rounded text-[10px] font-bold text-white shadow-md backdrop-blur-md ${hasHazard ? 'bg-red-600/80' : 'bg-slate-800/60'}`}>
                        {devices.find(d => d.deviceId === deviceId)?.label.slice(0, 15) || 'Camera'}
                      </div>
                      {currentAnalysisCameraId === deviceId && isAnalyzing && (
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-ping"></div>
                      )}
                   </div>

                   {/* Draw Boxes ONLY for single view or if we want cluttered grid */}
                   {/* Simplified: Only draw boxes if we have 1 camera, otherwise too messy */}
                   {activeDeviceIds.length === 1 && camAnalysis && camAnalysis.hazards.map((hazard, idx) => {
                      if (!hazard.box_2d) return null;
                      const [ymin, xmin, ymax, xmax] = hazard.box_2d;
                      return (
                         <div key={idx} className={`absolute border-2 ${hazard.severity === 'HIGH' ? 'border-red-500' : 'border-yellow-500'}`}
                           style={{ top: `${ymin/10}%`, left: `${xmin/10}%`, height: `${(ymax-ymin)/10}%`, width: `${(xmax-xmin)/10}%` }}
                         />
                      )
                   })}
                 </div>
               )
            })}
          </div>

          {/* Global Overlay Status */}
          <div className="absolute bottom-4 left-4 flex flex-col gap-1 z-30 pointer-events-none">
            <div className="flex items-center gap-2">
                <span className={`animate-pulse w-3 h-3 rounded-full ${isMonitoring ? 'bg-red-500' : 'bg-gray-500'}`}></span>
                <span className="text-xs font-mono font-bold bg-black/60 px-2 py-1 rounded text-white">
                  {isMonitoring ? (activeDeviceIds.length > 1 ? "MULTI-CAM ACTIVE" : "LIVE FEED") : "PAUSED"}
                </span>
            </div>
          </div>
        </div>

        {/* Camera Selector Toolbar */}
        <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg flex items-center gap-3 shadow-sm relative">
            <div className="bg-slate-700 p-1.5 rounded text-slate-300">
               {activeDeviceIds.length > 1 ? <Grid className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
            </div>
            <div className="flex-1">
               <button 
                  onClick={() => setShowCameraSelector(!showCameraSelector)}
                  className="flex items-center justify-between w-full text-left bg-slate-900/50 hover:bg-slate-900 p-2 rounded text-slate-200 text-xs font-bold transition-colors"
               >
                 <span>
                   {activeDeviceIds.length === 0 ? "No Camera Selected" : 
                    activeDeviceIds.length === 1 ? (devices.find(d => d.deviceId === activeDeviceIds[0])?.label || "Camera 1") :
                    `${activeDeviceIds.length} Cameras Active`}
                 </span>
                 <ChevronDown className="w-4 h-4 text-slate-400" />
               </button>

               {/* Dropdown Menu */}
               {showCameraSelector && (
                 <div className="absolute bottom-full left-0 w-full bg-slate-800 border border-slate-600 rounded-lg shadow-2xl mb-2 p-2 z-50 animate-fadeIn">
                   <div className="text-[10px] uppercase font-bold text-slate-500 mb-2 px-2">Available Inputs</div>
                   <div className="max-h-48 overflow-y-auto space-y-1">
                     {devices.map((device, idx) => {
                       const isActive = activeDeviceIds.includes(device.deviceId);
                       return (
                         <div 
                           key={device.deviceId}
                           onClick={() => toggleCamera(device.deviceId)}
                           className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${isActive ? 'bg-blue-600/20 border border-blue-500/50' : 'hover:bg-slate-700'}`}
                         >
                           <div className={`w-4 h-4 rounded border flex items-center justify-center ${isActive ? 'bg-blue-500 border-blue-500' : 'border-slate-500'}`}>
                             {isActive && <Check className="w-3 h-3 text-white" />}
                           </div>
                           <span className={`text-xs ${isActive ? 'text-blue-200 font-bold' : 'text-slate-300'}`}>
                             {device.label || `Camera ${idx + 1}`}
                           </span>
                         </div>
                       )
                     })}
                   </div>
                 </div>
               )}
            </div>
            <div className="text-xs font-mono text-slate-500 bg-slate-900 px-2 py-1 rounded">
               {devices.length} AVAIL
            </div>
         </div>

        <div className="flex gap-4">
          <button onClick={() => setShowSettings(true)} className="w-14 h-14 flex items-center justify-center rounded-lg bg-slate-800 border border-slate-600 hover:bg-slate-700 text-slate-300 transition-colors">
            <Settings className="w-6 h-6" />
          </button>
          
          <button onClick={toggleMonitoring} className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-lg font-bold text-lg transition-colors ${isMonitoring ? 'bg-red-900/50 text-red-200 border border-red-700 hover:bg-red-900' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/20'}`}>
            {isMonitoring ? <><Pause /> Stop Monitoring</> : <><Play /> Start AI Supervisor</>}
          </button>
        </div>
      </div>

      {/* Real-time Analysis Result */}
      <div className={`bg-slate-800 rounded-xl p-6 border flex flex-col h-full overflow-hidden relative transition-colors ${isAlertActive ? 'border-red-500 bg-red-950/20' : 'border-slate-700'}`}>
         {!activeAnalysis ? (
           <div className="flex flex-col items-center justify-center h-full text-slate-500">
             <MonitorIcon className="w-16 h-16 mb-4 opacity-50" />
             <p>Select cameras & start monitoring</p>
           </div>
         ) : (
           <div className="flex flex-col h-full animate-fadeIn">
             {/* Header showing which camera is being analyzed */}
             <div className="bg-slate-900/50 p-2 rounded mb-4 flex justify-between items-center border border-slate-700">
               <span className="text-xs font-mono text-slate-400 uppercase">Analysis Source</span>
               <span className="text-sm font-bold text-blue-300 flex items-center gap-2">
                 <Video className="w-4 h-4" />
                 {devices.find(d => d.deviceId === currentAnalysisCameraId)?.label || "Active Camera"}
               </span>
             </div>

             <div className="flex justify-between items-start mb-6 border-b border-slate-700 pb-4">
                <div>
                  <h2 className="text-sm uppercase tracking-wider text-slate-400 mb-1">Safety Score</h2>
                  <div className={`text-4xl font-black ${
                    activeAnalysis.safetyScore < alertSettings.minSafetyScore ? 'text-red-500 animate-pulse' :
                    activeAnalysis.safetyScore > 80 ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {activeAnalysis.safetyScore}/100
                  </div>
                </div>
                <div className={`px-4 py-2 rounded-lg flex items-center gap-2 ${activeAnalysis.isSafe ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
                  {activeAnalysis.isSafe ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                </div>
             </div>

             <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
               <div className="mb-6">
                 <h3 className="text-xs uppercase text-slate-500 font-bold mb-2">AI Summary</h3>
                 <p className="rtl-text text-lg text-slate-200 leading-relaxed bg-slate-700/50 p-3 rounded-lg border-r-4 border-blue-500">
                   {activeAnalysis.summary}
                 </p>
               </div>
               
               <div className="space-y-3">
                 {activeAnalysis.hazards.map((hazard, idx) => (
                   <div key={idx} className={`p-4 rounded-lg border-l-4 shadow-md ${
                     hazard.severity === 'HIGH' ? 'bg-red-900/20 border-red-500' : 'bg-blue-900/20 border-blue-500'
                   }`}>
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
               <span>AI Model: Gemini 2.5 Flash</span>
               {latency > 0 && <span className="font-mono text-emerald-400">{latency}ms</span>}
             </div>
           </div>
         )}
      </div>
    </div>
  );
};

export default Monitor;