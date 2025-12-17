export interface Hazard {
  type: string; // e.g., "No Helmet", "Trip Hazard"
  category: 'PPE' | 'MACHINERY' | 'HOUSEKEEPING' | 'FIRE' | 'BEHAVIOR' | 'OTHER';
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';
  confidence: number; // 0-100
  description: string; // Detailed description in Persian
  recommendation: string; // Action item in Persian
  box_2d?: number[]; // [ymin, xmin, ymax, xmax] normalized 0-1000 scale
}

export interface SafetyAnalysis {
  timestamp: string;
  safetyScore: number; // 0-100
  hazards: Hazard[];
  summary: string; // Persian summary
  isSafe: boolean;
}

export interface LogEntry extends SafetyAnalysis {
  id: string;
  thumbnail?: string; // Base64 snapshot
  videoUrl?: string; // Blob URL of the recorded clip if available
  cameraLabel?: string; // Name of the camera source
}

export enum AppTab {
  DASHBOARD = 'dashboard',
  MONITOR = 'monitor',
  REPORTS = 'reports',
  RESOURCES = 'resources'
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