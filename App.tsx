import React, { useState } from 'react';
import { Shield, Activity, List, Video, AlertOctagon, Download, Sparkles, FileText, Loader2, PlayCircle, MapPin, ExternalLink, Navigation } from 'lucide-react';
import Monitor from './components/Monitor';
import SafetyChart from './components/SafetyChart';
import { LogEntry, AppTab, GroundingChunk } from './types';
import { generateSessionReport, findNearbyEmergencyServices } from './services/geminiService';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.MONITOR);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  
  // Resources Tab State
  const [emergencyText, setEmergencyText] = useState<string | null>(null);
  const [groundingChunks, setGroundingChunks] = useState<GroundingChunk[]>([]);
  const [isLocating, setIsLocating] = useState(false);

  const handleNewAnalysis = (entry: LogEntry) => {
    setLogs(prev => [entry, ...prev]);
  };

  const handleExportCSV = () => {
    if (logs.length === 0) return;

    // BOM is essential for Excel to read Persian/UTF-8 characters correctly
    const BOM = "\uFEFF";
    const headers = ['ID', 'Timestamp', 'Camera', 'Safety Score', 'Status', 'Summary', 'Hazards'];
    
    const csvRows = logs.map(log => {
      const status = log.isSafe ? 'Safe' : 'Risk Detected';
      // Flatten hazards into a single string
      const hazardsDetails = log.hazards.map(h => 
        `[${h.severity}] ${h.type}: ${h.description} -> Action: ${h.recommendation}`
      ).join(' | ');

      // Helper to escape CSV special characters
      const escape = (text: string | number | undefined) => `"${String(text || '').replace(/"/g, '""')}"`;

      return [
        escape(log.id),
        escape(log.timestamp),
        escape(log.cameraLabel),
        escape(log.safetyScore),
        escape(status),
        escape(log.summary),
        escape(hazardsDetails)
      ].join(',');
    });

    const csvContent = BOM + [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hse_report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleGenerateAIReport = async () => {
    if (logs.length === 0) return;
    setIsGeneratingReport(true);
    setAiReport(null);
    try {
      const report = await generateSessionReport(logs);
      setAiReport(report);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleLocateServices = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setIsLocating(true);
    setEmergencyText(null);
    setGroundingChunks([]);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const result = await findNearbyEmergencyServices(latitude, longitude);
          setEmergencyText(result.text);
          setGroundingChunks(result.chunks);
        } catch (err) {
          console.error(err);
          setEmergencyText("Failed to retrieve emergency data.");
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        console.error(error);
        setIsLocating(false);
        setEmergencyText("Unable to retrieve location. Please allow location access.");
      }
    );
  };

  // Derived Stats
  const currentScore = logs.length > 0 ? logs[0].safetyScore : 100;
  const highSeverityCount = logs.length > 0 ? logs[0].hazards.filter(h => h.severity === 'HIGH').length : 0;
  const totalIncidents = logs.reduce((acc, curr) => acc + curr.hazards.length, 0);

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white selection:bg-orange-500 selection:text-white">
      {/* Header */}
      <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6 shadow-lg z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center shadow-lg shadow-orange-900/20">
            <Shield className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-100">HSE Guardian AI</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Intelligent Safety System</p>
          </div>
        </div>

        <nav className="flex gap-2">
          {[
            { id: AppTab.MONITOR, icon: Video, label: 'Live Monitor' },
            { id: AppTab.DASHBOARD, icon: Activity, label: 'Dashboard' },
            { id: AppTab.REPORTS, icon: List, label: 'Logs' },
            { id: AppTab.RESOURCES, icon: MapPin, label: 'Resources' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/50'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
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

        {activeTab === AppTab.DASHBOARD && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full overflow-y-auto">
            {/* KPI Cards */}
            <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
                <div className="text-slate-400 text-sm font-medium mb-1">Current Safety Score</div>
                <div className={`text-4xl font-black ${currentScore < 60 ? 'text-red-500' : 'text-emerald-500'}`}>
                  {currentScore}
                </div>
              </div>
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
                <div className="text-slate-400 text-sm font-medium mb-1">Active High Risks</div>
                <div className={`text-4xl font-black ${highSeverityCount > 0 ? 'text-red-500 animate-pulse' : 'text-slate-200'}`}>
                  {highSeverityCount}
                </div>
              </div>
              <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
                <div className="text-slate-400 text-sm font-medium mb-1">Total Hazards Detected</div>
                <div className="text-4xl font-black text-blue-400">
                  {totalIncidents}
                </div>
              </div>
            </div>

            {/* Chart Area */}
            <div className="md:col-span-2 bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl flex flex-col min-h-[300px]">
              <h3 className="text-lg font-bold text-slate-200 mb-4">Safety Score Trend</h3>
              <div className="flex-1">
                <SafetyChart data={[...logs].reverse()} />
              </div>
            </div>

            {/* Recent Alerts Feed */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-xl flex flex-col h-full overflow-hidden">
              <h3 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2">
                <AlertOctagon className="text-orange-500 w-5 h-5"/> Recent Alerts
              </h3>
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
                {logs.length === 0 ? (
                  <p className="text-slate-500 text-center py-4">No data yet.</p>
                ) : (
                  logs.slice(0, 10).map((log) => (
                    log.hazards.length > 0 && (
                      <div key={log.id} className="bg-slate-700/50 p-3 rounded border-l-2 border-orange-500">
                        <div className="flex justify-between items-center mb-1">
                           <div className="flex flex-col">
                             <span className="text-xs text-slate-400">{log.timestamp}</span>
                             {log.cameraLabel && <span className="text-[10px] text-blue-400 font-bold">{log.cameraLabel}</span>}
                           </div>
                           <span className="text-xs font-bold bg-orange-500/20 text-orange-400 px-2 rounded">
                             Score: {log.safetyScore}
                           </span>
                        </div>
                        <div className="space-y-1">
                          {log.hazards.map((h, i) => (
                             <div key={i} className="text-sm text-slate-200 rtl-text text-right">
                               • {h.type}
                             </div>
                          ))}
                        </div>
                      </div>
                    )
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === AppTab.REPORTS && (
          <div className="h-full overflow-y-auto pr-2 scrollbar-thin max-w-5xl mx-auto">
             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 border-b border-slate-700 pb-4 gap-4">
               <div>
                  <h2 className="text-2xl font-bold text-slate-100">Full Incident Log</h2>
                  <p className="text-slate-400 text-sm mt-1">Review captured events and generate insights.</p>
               </div>
               
               <div className="flex gap-2">
                 <button 
                   onClick={handleGenerateAIReport}
                   disabled={logs.length === 0 || isGeneratingReport}
                   className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-lg shadow-indigo-900/30"
                 >
                   {isGeneratingReport ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                   AI Analysis
                 </button>
                 <button 
                   onClick={handleExportCSV}
                   disabled={logs.length === 0}
                   className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-md border border-slate-600"
                 >
                   <Download className="w-4 h-4" /> CSV
                 </button>
               </div>
             </div>

             {/* AI Report Section */}
             {aiReport && (
               <div className="mb-8 bg-slate-800/80 border border-indigo-500/50 rounded-xl p-6 shadow-lg shadow-indigo-900/20 relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-indigo-500"></div>
                 <h3 className="text-xl font-bold text-indigo-300 mb-4 flex items-center gap-2">
                   <Sparkles className="w-5 h-5" /> Executive Safety Summary
                 </h3>
                 <div className="prose prose-invert prose-sm max-w-none text-slate-300 rtl-text whitespace-pre-wrap leading-relaxed">
                   {aiReport}
                 </div>
                 <div className="mt-4 flex justify-end">
                   <button onClick={() => setAiReport(null)} className="text-xs text-slate-500 hover:text-slate-300 underline">
                     Dismiss Report
                   </button>
                 </div>
               </div>
             )}

             <div className="space-y-4">
                {logs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 bg-slate-800/50 rounded-xl border border-dashed border-slate-700">
                    No logs recorded yet. Start monitoring to generate reports.
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-md flex flex-col md:flex-row">
                      <div className="w-full md:w-48 h-32 md:h-auto bg-black relative shrink-0 group">
                        {log.thumbnail && (
                          <img src={log.thumbnail} alt="Snap" className="w-full h-full object-cover opacity-80" />
                        )}
                        <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded font-mono">
                          {log.timestamp}
                        </div>
                        {log.videoUrl && (
                          <a 
                             href={log.videoUrl} 
                             target="_blank" 
                             rel="noopener noreferrer"
                             className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <PlayCircle className="w-12 h-12 text-white drop-shadow-lg" />
                          </a>
                        )}
                        {log.videoUrl && (
                          <div className="absolute bottom-2 right-2 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-sm">
                            <Video className="w-3 h-3" /> CLIP
                          </div>
                        )}
                      </div>
                      <div className="p-4 flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex gap-2 items-center">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${log.isSafe ? 'bg-emerald-900 text-emerald-400' : 'bg-red-900 text-red-400'}`}>
                              {log.isSafe ? "SAFE" : "HAZARD"}
                            </span>
                            <span className="px-2 py-1 rounded text-xs font-bold bg-slate-700 text-slate-300">
                              Score: {log.safetyScore}
                            </span>
                            {log.cameraLabel && (
                              <span className="px-2 py-1 rounded text-xs font-bold bg-blue-900/50 text-blue-300 border border-blue-500/30">
                                {log.cameraLabel}
                              </span>
                            )}
                          </div>
                          {log.videoUrl && (
                             <a 
                               href={log.videoUrl} 
                               target="_blank" 
                               rel="noopener noreferrer"
                               className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-2 py-1 rounded bg-indigo-500/10"
                             >
                               <PlayCircle className="w-3 h-3" /> Evidence Clip
                             </a>
                          )}
                        </div>
                        <p className="text-slate-300 rtl-text mb-3">{log.summary}</p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {log.hazards.map((h, i) => (
                            <div key={i} className="text-sm bg-slate-700/30 p-2 rounded rtl-text border-r-2 border-slate-600">
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
          <div className="h-full overflow-y-auto pr-2 scrollbar-thin max-w-5xl mx-auto">
            <div className="mb-6 border-b border-slate-700 pb-4">
              <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                 <Navigation className="w-6 h-6 text-blue-500" /> Emergency & Safety Resources
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                Locate nearest medical centers, fire stations, and industrial safety equipment suppliers using Google Maps Grounding.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
               <div className="lg:col-span-1">
                 <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-lg">
                    <h3 className="text-lg font-bold text-white mb-4">Location Services</h3>
                    <p className="text-sm text-slate-400 mb-6">
                      Click the button below to allow geolocation access. We will find relevant safety resources based on your current coordinates.
                    </p>
                    <button 
                      onClick={handleLocateServices}
                      disabled={isLocating}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-all shadow-lg shadow-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLocating ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
                      {isLocating ? "Locating..." : "Find Nearby Resources"}
                    </button>
                 </div>
               </div>

               <div className="lg:col-span-2">
                 {emergencyText ? (
                   <div className="space-y-6">
                     <div className="bg-slate-800/80 rounded-xl p-6 border border-slate-700 shadow-lg">
                       <h3 className="text-sm uppercase font-bold text-blue-400 mb-3 flex items-center gap-2">
                         <Sparkles className="w-4 h-4" /> AI Recommendation
                       </h3>
                       <div className="prose prose-invert prose-sm max-w-none text-slate-200 whitespace-pre-wrap leading-relaxed">
                         {emergencyText}
                       </div>
                     </div>
                     
                     {groundingChunks.length > 0 && (
                       <div>
                         <h3 className="text-sm uppercase font-bold text-slate-500 mb-3">Verified Locations</h3>
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           {groundingChunks.map((chunk, idx) => {
                             const mapData = chunk.maps;
                             if (!mapData) return null;
                             return (
                               <a 
                                 key={idx}
                                 href={mapData.uri}
                                 target="_blank"
                                 rel="noopener noreferrer"
                                 className="flex items-center justify-between p-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg group transition-colors"
                               >
                                 <div className="flex items-center gap-3">
                                   <div className="w-8 h-8 rounded-full bg-blue-900/30 flex items-center justify-center text-blue-400">
                                     <MapPin className="w-4 h-4" />
                                   </div>
                                   <span className="font-bold text-slate-200 text-sm">{mapData.title}</span>
                                 </div>
                                 <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                               </a>
                             )
                           })}
                         </div>
                       </div>
                     )}
                   </div>
                 ) : (
                   <div className="h-64 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl">
                      <Navigation className="w-12 h-12 mb-2 opacity-50" />
                      <p>Waiting for location request...</p>
                   </div>
                 )}
               </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}