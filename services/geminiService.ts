import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SafetyAnalysis, LogEntry, GroundingChunk } from "../types";
import { checkLicense } from "./licenseService";

// Timeout configuration to prevent hanging processes
const API_TIMEOUT_MS = 15000;

const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    safetyScore: {
      type: Type.NUMBER,
      description: "A score from 0 to 100, where 100 is perfectly safe.",
    },
    isSafe: {
      type: Type.BOOLEAN,
      description: "True if the environment is generally safe.",
    },
    summary: {
      type: Type.STRING,
      description: "A brief executive summary of the safety situation in Persian (Farsi).",
    },
    hazards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          category: { 
            type: Type.STRING, 
            enum: ['PPE', 'MACHINERY', 'HOUSEKEEPING', 'FIRE', 'BEHAVIOR', 'OTHER']
          },
          severity: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW", "SAFE"] },
          confidence: { type: Type.INTEGER },
          description: { type: Type.STRING },
          recommendation: { type: Type.STRING },
          box_2d: { 
            type: Type.ARRAY, 
            items: { type: Type.INTEGER }
          }
        },
        required: ["type", "category", "severity", "confidence", "description", "recommendation", "box_2d"],
      },
    },
  },
  required: ["safetyScore", "isSafe", "summary", "hazards"],
};

const getApiKey = (): string | undefined => {
  try {
    // Robust check for various environments (Web, Electron, Node)
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
    // Fallback for some bundlers
    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_KEY) {
      return (import.meta as any).env.VITE_API_KEY;
    }
  } catch (e) {
    // Ignore access errors
  }
  return undefined;
};

const ensureAuthorized = () => {
  if (!checkLicense()) {
    throw new Error("UNAUTHORIZED_ACCESS");
  }
};

// Helper to race promises with timeout
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
            setTimeout(() => reject(new Error("REQUEST_TIMEOUT")), ms)
        )
    ]);
};

export const analyzeSafetyImage = async (base64Image: string): Promise<SafetyAnalysis> => {
  try {
    ensureAuthorized();

    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key not configured");

    const ai = new GoogleGenAI({ apiKey });

    // Optimize prompt for speed and strict JSON
    const prompt = `Analyze this CCTV frame for industrial safety. Return JSON only.
    Output Persian (Farsi) text for descriptions.
    Focus on: PPE, Machinery, Fire, Housekeeping.
    Detect hazards with bounding boxes (box_2d [ymin, xmin, ymax, xmax] 0-1000).`;

    const request = ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
        systemInstruction: "You are a fast, real-time safety AI.",
        // Performance tuning: Lower thinking budget or turn it off for speed if supported, 
        // strictly follow schema.
      },
    });

    const response = await withTimeout<GenerateContentResponse>(request, API_TIMEOUT_MS);

    if (response.text) {
      const data = JSON.parse(response.text);
      return {
        ...data,
        timestamp: new Date().toLocaleTimeString('fa-IR'),
      };
    }
    throw new Error("Empty response from AI");

  } catch (error) {
    const msg = (error as Error).message;
    console.warn("Analysis skipped:", msg); // Warn instead of Error to keep console clean

    if (msg.includes("UNAUTHORIZED")) {
        return {
            timestamp: new Date().toLocaleTimeString(),
            safetyScore: 0,
            isSafe: false,
            summary: "خطای امنیتی: لایسنس نامعتبر.",
            hazards: []
        };
    }
    
    // Return a 'Safe' fallback state on timeout to prevent UI flickering/panic
    if (msg === "REQUEST_TIMEOUT") {
         return {
            timestamp: new Date().toLocaleTimeString(),
            safetyScore: -1, // Indicator for timeout
            isSafe: true, // Assume safe on momentary glitch
            summary: "تاخیر در ارتباط با شبکه...",
            hazards: []
        };
    }

    return {
      timestamp: new Date().toLocaleTimeString(),
      safetyScore: 0,
      isSafe: false,
      summary: "خطا در پردازش تصویر.",
      hazards: [],
    };
  }
};

export const generateSessionReport = async (logs: LogEntry[]): Promise<string> => {
  try {
    ensureAuthorized();
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key missing");

    const ai = new GoogleGenAI({ apiKey });

    // Memory Optimization: Only send essential data, remove heavy fields if any
    const leanLogs = logs.slice(0, 30).map(({ thumbnail, videoUrl, ...rest }) => rest);
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{
          text: `Generate a Persian HSE Executive Report based on these logs: ${JSON.stringify(leanLogs)}. 
          Format: Markdown. Include Trends, Key Risks, and Recommendations.`
        }]
      }
    });

    return response.text || "Report generation failed.";
  } catch (error) {
    console.error("Report Error:", error);
    return "خطا در تولید گزارش. لطفا اتصال اینترنت را بررسی کنید.";
  }
};

export const findNearbyEmergencyServices = async (lat: number, lng: number): Promise<{text: string, chunks: GroundingChunk[]}> => {
  try {
     ensureAuthorized();
     const apiKey = getApiKey();
     if (!apiKey) throw new Error("API Key missing");

     const ai = new GoogleGenAI({ apiKey });
     
     const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: "Find nearest hospitals and fire stations. Brief list.",
      config: {
        tools: [{googleMaps: {}}],
        toolConfig: { retrievalConfig: { latLng: { latitude: lat, longitude: lng } } }
      },
    });
    
    return {
      text: response.text || "No info found.",
      chunks: (response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[]) || []
    };
  } catch (e) {
    return { text: "خطا در سرویس نقشه.", chunks: [] };
  }
};