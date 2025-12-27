import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { SafetyAnalysis, LogEntry, GroundingChunk } from "../types";
import { checkLicense } from "./licenseService";

// Timeout configuration: Reduced to 10s for faster fail-over
const API_TIMEOUT_MS = 10000;

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

const ensureAuthorized = () => {
  if (!checkLicense()) {
    throw new Error("UNAUTHORIZED_ACCESS");
  }
};

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
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Use gemini-2.5-flash for maximum speed/stability
    const request = ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image } },
          { text: "Analyze industrial safety. JSON output only. Persian text. Detect hazards." },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
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
    console.warn("Analysis skipped:", msg);

    if (msg.includes("UNAUTHORIZED")) {
        return {
            timestamp: new Date().toLocaleTimeString(),
            safetyScore: 0,
            isSafe: false,
            summary: "خطای امنیتی: لایسنس نامعتبر.",
            hazards: []
        };
    }
    
    // Handle Timeout specifically
    if (msg === "REQUEST_TIMEOUT") {
         return {
            timestamp: new Date().toLocaleTimeString(),
            safetyScore: -1, 
            isSafe: true, 
            summary: "Timeout", // Short summary
            hazards: []
        };
    }

    return {
      timestamp: new Date().toLocaleTimeString(),
      safetyScore: 0,
      isSafe: false,
      summary: "Error",
      hazards: [],
    };
  }
};

export const generateSessionReport = async (logs: LogEntry[]): Promise<string> => {
  try {
    ensureAuthorized();
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const leanLogs = logs.slice(0, 30).map(({ thumbnail, videoUrl, ...rest }) => rest);
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{
          text: `Generate a Persian HSE Executive Report based on these logs: ${JSON.stringify(leanLogs)}. Format: Markdown.`
        }]
      }
    });

    return response.text || "Report generation failed.";
  } catch (error) {
    console.error("Report Error:", error);
    return "خطا در تولید گزارش.";
  }
};

export const findNearbyEmergencyServices = async (lat: number, lng: number): Promise<{text: string, chunks: GroundingChunk[]}> => {
  try {
     ensureAuthorized();
     const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
     const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: "Find nearest hospitals and fire stations.",
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