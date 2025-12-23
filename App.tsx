
import React, { useState, useEffect } from 'react';
import { Shield, Activity, List, Video, AlertOctagon, Download, Sparkles, FileText, Loader2, PlayCircle, MapPin, ExternalLink, Navigation, Settings, Smartphone, Monitor as MonitorIcon, Key, Link as LinkIcon, RefreshCw, Zap, Map, Lock, AlertTriangle, Mic } from 'lucide-react';
import Monitor from './components/Monitor';
import SafetyChart from './components/SafetyChart';
import VoiceAssistant from './components/VoiceAssistant';
import { LogEntry, AppTab, GroundingChunk, ConnectedDevice } from './types';
import { generateSessionReport, findNearbyEmergencyServices } from './services/geminiService';
import { activateLicense, checkLicense, deactivate, generateTestKey } from './services/licenseService';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.MONITOR);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isActivated, setIsActivated] = useState(false);
  const [serialKey, setSerialKey] = useState('');
  const [activationError, setActivationError] = useState('');
  
  // Report State
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);

  // Resources State
  const [isLocating, setIsLocating] = useState(false);
  const [emergencyData, setEmergencyData] = useState<{text: string, chunks: GroundingChunk[]} | null>(null);
  
  // شبیه‌سازی دستگاه‌های همگام
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([
    { id: 'dev-1', name: 'واحد نظارت مرکزی', type: 'Desktop', lastSeen: 'هم‌اکنون', status: 'Online' },
    { id: 'dev-2', name: 'تبلت بازرس HSE', type: 'Android', lastSeen: '۵ دقیقه پیش', status: 'Online' }
  ]);

  const handleNewAnalysis = (entry: LogEntry) => {
    // در دنیای واقعی این داده به سرور ارسال می‌شود تا در تمام دستگاه‌ها همگام شود
    setLogs(prev => [entry, ...prev]);
  };

  const handleActivation = () => {
    setActivationError('');
    if (activateLicense(serialKey)) {
      setIsActivated(true);
    } else {
      setActivationError('کد لایسنس نامعتبر است. فرمت صحیح: HSE-XXXX-YYYY');
    }
  };

  const handleGenerateReport = async () => {
    if (logs.length === 0) return;
    setIsReportLoading(true);
    const report = await generateSessionReport(logs);
    setReportMarkdown(report);
    setIsReportLoading(false);
  };

  const handleFindServices = async () => {
    setIsLocating(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        const result = await findNearbyEmergencyServices(latitude, longitude);
        setEmergencyData(result);
        setIsLocating(false);
      }, (err) => {
         console.error("Geo Error", err);
         findNearbyEmergencyServices(35.6892, 51.3890).then(res => {
            setEmergencyData(res);
            setIsLocating(false);
         });
      });
    } else {
        alert("Geolocaiton is not supported by this browser.");
        setIsLocating(false);
    }
  };

  // Check License on Mount
  useEffect(() => {
    const isValid = checkLicense();
    if (isValid) {
      setIsActivated(true);
    } else {
      // For Demo purposes, show a hint
      // console.log("Demo Key:", generateTestKey());
    }
  }, []);

  if (!isActivated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 rtl-text relative overflow-hidden">
        {/* Background Grid Animation */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:14px_24px] pointer-events-none"></div>

        <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl relative z-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl flex items-center justify-center shadow-2xl mb-4 relative">
              <Shield className="text-white w-12 h-12" />
              <div className="absolute -bottom-2 -right-2 bg-slate-900 rounded-full p-1 border border-slate-700">
                 <Lock className="w-4 h-4 text-red-500" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white">Security Check</h1>
            <p className="text-slate-400 text-center text-sm mt-2 leading-relaxed">
              سیستم امنیتی HSE Guardian فعال است. جهت دسترسی به کنسول، لایسنس سازمانی خود را وارد کنید.
            </p>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 mr-1">کلید لایسنس (License Key)</label>
              <div className="relative group">
                <Key className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors ${activationError ? 'text-red-500' : 'text-slate-500 group-focus-within:text-orange-500'}`} />
                <input 
                  type="text" 
                  value={serialKey}
                  onChange={(e) => setSerialKey(e.target.value)}
                  placeholder="HSE-XXXX-YYYY"
                  className={`w-full bg-slate-900 border rounded-xl py-3 pl-10 pr-4 text-white outline-none transition-all text-center tracking-widest font-mono ${activationError ? 'border-red-500 focus:border-red-500' : 'border-slate-700 focus:border-orange-500'}`}
                />
              </div>
              {activationError && (
                 <div className="flex items-center gap-1mt-2 text-xs text-red-400 mt-2 animate-pulse">
                    <AlertTriangle className="w-3 h-3" /> {activationError}
                 </div>
              )}
            </div>
            
            <button 
              onClick={handleActivation}
              className="w-full py-4 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl shadow-lg shadow-orange-900/40 transition-all flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" /> اعتبارسنجی و ورود
            </button>

            {/* Hint for Demo User */}
            <div className="mt-4 p-3 bg-slate-700/30 rounded border border-slate-700 text-[10px] text-slate-400 text-center font-mono">
               Example Valid Key (For Testing): <span className="text-emerald-400 select-all">{generateTestKey()}</span>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-slate-700 text-center">
            <p className="text-[10px] text-slate-500 leading-relaxed uppercase tracking-widest">
              Secured by HSE-Crypto-V1 <br/> Unauthorized access is prohibited
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white selection:bg-orange-500 selection:text-white rtl-text">
      {/* Header */}
      <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6 shadow-lg z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center shadow-lg shadow-orange-900/20">
            <Shield className="text-white w-6 h-6" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-bold tracking-tight text-slate-100">HSE Guardian AI</h1>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              <p className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">شبکه امنیتی فعال</p>
            </div>
          </div>
        </div>

        <nav className="flex gap-1 sm:gap-2">
          {[
            { id: AppTab.MONITOR, icon: Video, label: 'مانیتورینگ' },
            { id: AppTab.DASHBOARD, icon: Activity, label: 'داشبورد' },
            { id: AppTab.VOICE_ASSISTANT, icon: Mic, label: 'دستیار صوتی' },
            { id: AppTab.REPORTS, icon: List, label: 'گزارشات' },
            { id: AppTab.RESOURCES, icon: Map, label: 'منابع' },
            { id: AppTab.SETTINGS, icon: Settings, label: 'تنظیمات' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/50'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden p-4 sm:p-6 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black pointer-events-none -z-10"></div>
        
        {activeTab === AppTab.MONITOR && (
          <Monitor onNewAnalysis={handleNewAnalysis} />
        )}
        
        {activeTab === AppTab.VOICE_ASSISTANT && (
          <VoiceAssistant />
        )}

        {activeTab === AppTab.DASHBOARD && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full overflow-y-auto">
            {/* KPI Cards */}
            <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl relative overflow-hidden group">
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                  <Activity className="w-24 h-24" />
                </div>
                <div className="text-slate-400 text-sm font-medium mb-1">امتیاز ایمنی واحد</div>
                <div className={`text-4xl font-black ${logs[0]?.safetyScore < 60 ? 'text-red-500' : 'text-emerald-500'}`}>
                  {logs[0]?.safetyScore || 100}
                </div>
                <div className="mt-2 text-[10px] text-slate-500">بروزرسانی شده از مانیتور دسکتاپ</div>
              </div>
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl relative overflow-hidden group">
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                  <AlertOctagon className="w-24 h-24" />
                </div>
                <div className="text-slate-400 text-sm font-medium mb-1">خطرات بحرانی فعال</div>
                <div className={`text-4xl font-black ${logs[0]?.hazards.length > 0 ? 'text-red-500 animate-pulse' : 'text-slate-200'}`}>
                  {logs[0]?.hazards.filter(h => h.severity === 'HIGH').length || 0}
                </div>
                <div className="mt-2 text-[10px] text-slate-500">رصد شده در ۳ دوربین فعال</div>
              </div>
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl relative overflow-hidden group">
                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
                  <RefreshCw className="w-24 h-24" />
                </div>
                <div className="text-slate-400 text-sm font-medium mb-1">دستگاه‌های همگام</div>
                <div className="text-4xl font-black text-blue-400">
                  {connectedDevices.filter(d => d.status === 'Online').length}
                </div>
                <div className="mt-2 text-[10px] text-slate-500">تمامی نسخه‌ها اکتیو هستند</div>
              </div>
            </div>

            {/* Chart Area */}
            <div className="md:col-span-2 bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl flex flex-col min-h-[300px]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-200">روند ایمنی شبکه</h3>
                <span className="text-xs bg-slate-700 px-2 py-1 rounded text-slate-400">یکپارچه با کل واحد</span>
              </div>
              <div className="flex-1">
                <SafetyChart data={[...logs].reverse()} />
              </div>
            </div>

            {/* Connected Devices Feed */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl flex flex-col h-full overflow-hidden">
              <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                <LinkIcon className="text-blue-500 w-5 h-5"/> وضعیت شبکه ایمنی
              </h3>
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                {connectedDevices.map((device) => (
                  <div key={device.id} className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-slate-800 ${device.status === 'Online' ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {device.type === 'Desktop' ? <MonitorIcon className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-200">{device.name}</div>
                        <div className="text-[10px] text-slate-500">آخرین فعالیت: {device.lastSeen}</div>
                      </div>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${device.status === 'Online' ? 'bg-emerald-500' : 'bg-slate-600'}`}></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === AppTab.REPORTS && (
          <div className="h-full overflow-y-auto pr-2 scrollbar-thin max-w-5xl mx-auto">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 border-b border-slate-700 pb-4 gap-4">
               <div>
                  <h2 className="text-2xl font-bold text-slate-100">تاریخچه وقایع یکپارچه</h2>
                  <p className="text-slate-400 text-sm mt-1">مشاهده داده‌های ثبت شده از تمام نسخه‌های فعال واحد.</p>
               </div>
               
               <div className="flex gap-2 w-full sm:w-auto">
                 <button 
                    onClick={handleGenerateReport}
                    disabled={isReportLoading || logs.length === 0}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all font-medium shadow-lg shadow-indigo-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   {isReportLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                   تحلیل هوشمند (Gemini)
                 </button>
                 <button 
                   onClick={() => setLogs([])}
                   className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors font-medium shadow-md border border-slate-600"
                 >
                   پاکسازی
                 </button>
                 <button 
                   className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white rounded-lg transition-all font-medium shadow-lg shadow-orange-900/30"
                 >
                   <Download className="w-4 h-4" /> خروجی اکسل
                 </button>
               </div>
             </div>

             {reportMarkdown && (
                <div className="mb-8 bg-slate-800 border-l-4 border-indigo-500 p-6 rounded-r-xl shadow-2xl relative animate-fadeIn">
                   <h3 className="text-indigo-400 font-bold mb-4 flex items-center gap-2">
                      <Sparkles className="w-5 h-5" /> گزارش تحلیلی هوش مصنوعی
                   </h3>
                   <div className="prose prose-invert prose-sm max-w-none text-slate-200 leading-loose whitespace-pre-wrap">
                      {reportMarkdown}
                   </div>
                   <button onClick={() => setReportMarkdown(null)} className="absolute top-4 left-4 text-slate-500 hover:text-white">
                      بستن
                   </button>
                </div>
             )}

             <div className="space-y-4">
                {logs.length === 0 ? (
                  <div className="text-center py-16 text-slate-600 border-2 border-dashed border-slate-800 rounded-2xl flex flex-col items-center">
                    <List className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-lg">هنوز واقعه‌ای در شبکه ایمنی ثبت نشده است.</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-md flex flex-col md:flex-row transition-all hover:border-orange-500/30">
                      <div className="w-full md:w-48 h-32 md:h-auto bg-black relative shrink-0 group">
                        {log.thumbnail && (
                          <img src={log.thumbnail} alt="Snap" className="w-full h-full object-cover opacity-80" />
                        )}
                        <div className="absolute top-2 right-2 bg-black/70 text-white text-[10px] px-2 py-1 rounded font-mono">
                          {log.timestamp}
                        </div>
                      </div>
                      <div className="p-4 flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex gap-2 items-center flex-wrap">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold ${log.isSafe ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
                              {log.isSafe ? "ایمن" : "خطر شناسایی شد"}
                            </span>
                            <span className="px-2 py-1 rounded text-[10px] font-bold bg-slate-700 text-slate-300">
                              امتیاز: {log.safetyScore}
                            </span>
                            {log.cameraLabel && (
                              <span className="px-2 py-1 rounded text-[10px] font-bold bg-blue-900/30 text-blue-300 border border-blue-500/20">
                                منبع: {log.cameraLabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-slate-300 text-sm mb-3 leading-relaxed">{log.summary}</p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {log.hazards.map((h, i) => (
                            <div key={i} className="text-[12px] bg-slate-900/50 p-2 rounded-lg border-r-2 border-orange-500/50">
                              <span className="text-orange-400 font-bold block mb-1">{h.type}</span>
                              <span className="text-slate-400">{h.recommendation}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
             </div>
          </div>
        )}

        {activeTab === AppTab.RESOURCES && (
          <div className="h-full flex flex-col items-center justify-start max-w-3xl mx-auto pt-10 px-4">
             <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700 w-full text-center">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-900/50">
                   <Map className="text-white w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">خدمات اضطراری نزدیک</h2>
                <p className="text-slate-400 mb-8">یافتن سریع بیمارستان‌ها، ایستگاه‌های آتش‌نشانی و تجهیزات ایمنی در اطراف شما با استفاده از هوش مصنوعی گوگل.</p>
                
                <button 
                  onClick={handleFindServices}
                  disabled={isLocating}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-8 rounded-xl shadow-xl transition-all flex items-center justify-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLocating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />}
                  {isLocating ? "در حال مکان‌یابی..." : "مکان‌یابی و جستجو"}
                </button>
             </div>

             {emergencyData && (
                <div className="mt-8 w-full bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl animate-fadeIn">
                   <div className="prose prose-invert prose-sm max-w-none mb-6 text-right" dir="auto">
                      <div className="whitespace-pre-wrap leading-loose text-slate-300">
                         {emergencyData.text}
                      </div>
                   </div>
                   
                   {emergencyData.chunks && emergencyData.chunks.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-700 pt-4">
                         {emergencyData.chunks.map((chunk, i) => {
                            if (!chunk.maps?.uri) return null;
                            return (
                               <a 
                                 key={i} 
                                 href={chunk.maps.uri} 
                                 target="_blank" 
                                 rel="noopener noreferrer"
                                 className="flex items-center gap-3 p-3 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors group"
                               >
                                  <div className="bg-blue-900/30 p-2 rounded text-blue-400 group-hover:text-blue-300">
                                     <MapPin className="w-5 h-5" />
                                  </div>
                                  <div className="flex-1 overflow-hidden">
                                     <div className="truncate font-bold text-slate-200">{chunk.maps.title || "مکان روی نقشه"}</div>
                                     <div className="text-xs text-blue-400 flex items-center gap-1">
                                        مشاهده در Google Maps <ExternalLink className="w-3 h-3" />
                                     </div>
                                  </div>
                               </a>
                            )
                         })}
                      </div>
                   )}
                </div>
             )}
          </div>
        )}

        {activeTab === AppTab.SETTINGS && (
          <div className="h-full overflow-y-auto pr-2 scrollbar-thin max-w-2xl mx-auto">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 p-8 shadow-2xl">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Settings className="w-6 h-6 text-slate-400" /> تنظیمات واحد و همگام‌سازی
              </h2>
              
              <div className="space-y-8">
                <section>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-slate-700 pb-2">وضعیت فعال‌سازی</h3>
                  <div className="bg-slate-900/50 p-4 rounded-xl border border-emerald-500/20 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        <Shield className="w-4 h-4 text-emerald-500" />
                        مجوز امنیتی فعال است
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1 font-mono">License Hash: {btoa(serialKey).slice(0, 10)}...</div>
                    </div>
                    <button 
                      onClick={() => { deactivate(); setIsActivated(false); }}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors border border-red-900/50 px-3 py-1.5 rounded-lg hover:bg-red-900/20"
                    >
                      غیرفعال‌سازی و خروج
                    </button>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-slate-700 pb-2">اشتراک‌گذاری خودکار</h3>
                  <div className="flex items-center justify-between p-2">
                    <span className="text-sm text-slate-300">ارسال گزارشات به تمام نسخه‌های فعال</span>
                    <div className="w-12 h-6 bg-orange-600 rounded-full relative">
                      <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full translate-x-6 transition-transform"></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-2">
                    <span className="text-sm text-slate-300">اعلام هشدار صوتی در اندروید</span>
                    <div className="w-12 h-6 bg-slate-700 rounded-full relative">
                      <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform"></div>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 border-b border-slate-700 pb-2">اطلاعات واحد</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block mr-1">نام واحد صنعتی</label>
                      <input type="text" defaultValue="کارخانه تولید قطعات خودرو - واحد ۱" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm outline-none focus:border-blue-500" />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 mb-1 block mr-1">مدیر HSE مسئول</label>
                      <input type="text" placeholder="نام و نام خانوادگی" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm outline-none focus:border-blue-500" />
                    </div>
                  </div>
                </section>
              </div>
              
              <div className="mt-8 pt-6 border-t border-slate-700 flex justify-end">
                <button className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-all">
                  ذخیره تنظیمات شبکه
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
