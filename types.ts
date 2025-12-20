export interface Hazard {
  type: string;
  category: 'PPE' | 'MACHINERY' | 'HOUSEKEEPING' | 'FIRE' | 'BEHAVIOR' | 'OTHER';
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  confidence: number;
  description: string;
  recommendation: string;
  box_2d?: number[];
}

export interface SafetyAnalysis {
  timestamp: string;
  safetyScore: number;
  hazards: Hazard[];
  summary: string;
  isSafe: boolean;
}

export interface LogEntry extends SafetyAnalysis {
  id: string;
  thumbnail?: string;
  videoUrl?: string;
  cameraLabel?: string;
  deviceId?: string; // برای شناسایی منبع ثبت داده
}

export interface ConnectedDevice {
  id: string;
  name: string;
  type: 'Desktop' | 'Android';
  lastSeen: string;
  status: 'Online' | 'Offline';
}

export enum AppTab {
  DASHBOARD = 'dashboard',
  MONITOR = 'monitor',
  REPORTS = 'reports',
  RESOURCES = 'resources',
  SETTINGS = 'settings'
}

export interface GroundingChunk {
  maps?: {
    uri?: string;
    title?: string;
  };
  web?: {
    uri?: string;
    title?: string;
  };
}