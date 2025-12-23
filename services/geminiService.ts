
import { GoogleGenAI, Type } from "@google/genai";
import { SafetyAnalysis, LogEntry, GroundingChunk } from "../types";
import { checkLicense } from "./licenseService";

// Using a plain object for responseSchema as per updated SDK best practices
const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    safetyScore: {
      type: Type.NUMBER,
      description: "A score from 0 to 100, where 100 is perfectly safe and 0 is extremely dangerous.",
    },
    isSafe: {
      type: Type.BOOLEAN,
      description: "True if the environment is generally safe, False if hazards exist.",
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
          type: { type: Type.STRING, description: "Short title of the hazard (e.g., 'Missing Helmet')" },
          category: { 
            type: Type.STRING, 
            enum: ['PPE', 'MACHINERY', 'HOUSEKEEPING', 'FIRE', 'BEHAVIOR', 'OTHER'],
            description: "The category of the hazard."
          },
          severity: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW", "SAFE"] },
          confidence: { type: Type.INTEGER, description: "AI confidence score for this detection (0-100)." },
          description: { type: Type.STRING, description: "Description of the hazard in Persian (Farsi)." },
          recommendation: { type: Type.STRING, description: "Immediate corrective action in Persian (Farsi)." },
          box_2d: { 
            type: Type.ARRAY, 
            description: "Bounding box coordinates [ymin, xmin, ymax, xmax] on a 1000x1000 scale for the detected hazard.",
            items: { type: Type.INTEGER }
          }
        },
        required: ["type", "category", "severity", "confidence", "description", "recommendation", "box_2d"],
      },
    },
  },
  required: ["safetyScore", "isSafe", "summary", "hazards"],
};

// Helper to safely get API key without crashing
const getApiKey = (): string | undefined => {
  try {
    if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
      return process.env.API_KEY;
    }
  } catch (e) {
    // Ignore access errors
  }
  return undefined;
};

// Security Guard
const ensureAuthorized = () => {
  if (!checkLicense()) {
    throw new Error("UNAUTHORIZED_ACCESS: License validation failed. Please reactivate the software.");
  }
};

export const analyzeSafetyImage = async (base64Image: string): Promise<SafetyAnalysis> => {
  try {
    ensureAuthorized(); // Security Check

    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("API Key not configured");
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", 
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
          {
            text: `You are an expert HSE Officer and AI Safety Supervisor for an industrial company. 
            Analyze this CCTV frame from the production line.
            Look for: PPE violations (helmets, vests, gloves), unsafe behaviors, trip hazards, blocked exits, machine guarding issues, and fatigue.
            
            IMPORTANT: 
            1. Provide all descriptions, summaries, and recommendations in Persian (Farsi).
            2. Detect specific objects or areas that constitute a hazard and provide bounding boxes (box_2d) for them.
            3. Classify each hazard into a category (PPE, MACHINERY, HOUSEKEEPING, FIRE, BEHAVIOR, OTHER).
            4. Assign a confidence score (0-100) to each detected hazard.
            5. Determine a safety score based on visual evidence.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
        systemInstruction: "You are a strict, detail-oriented Safety Officer. Your goal is Zero Harm.",
      },
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      return {
        ...data,
        timestamp: new Date().toLocaleTimeString(),
      };
    }
    throw new Error("No data returned from AI");
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    
    const msg = (error as Error).message;
    if (msg.includes("UNAUTHORIZED")) {
        return {
            timestamp: new Date().toLocaleTimeString(),
            safetyScore: 0,
            isSafe: false,
            summary: "خطای امنیتی: لایسنس نرم‌افزار نامعتبر است. دسترسی قطع شد.",
            hazards: []
        };
    }

    return {
      timestamp: new Date().toLocaleTimeString(),
      safetyScore: 0,
      isSafe: false,
      summary: msg === "API Key not configured" 
        ? "کلید API تنظیم نشده است. لطفاً تنظیمات برنامه را بررسی کنید." 
        : "خطا در ارتباط با هوش مصنوعی.",
      hazards: [],
    };
  }
};

export const generateSessionReport = async (logs: LogEntry[]): Promise<string> => {
  try {
    ensureAuthorized(); // Security Check
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key missing");

    const ai = new GoogleGenAI({ apiKey });

    const textLogs = logs.slice(0, 50).map(({ thumbnail, ...rest }) => rest);
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{
          text: `You are a Senior HSE Manager. Analyze the following JSON logs from today's safety monitoring session.
          
          Logs Data: ${JSON.stringify(textLogs)}
          
          Task:
          Write a comprehensive, professional executive report in Persian (Farsi).
          The report should include:
          1. **Overall Status**: Average safety score and general trend.
          2. **Key Risks**: The most frequent or dangerous hazards detected.
          3. **Timeline Analysis**: When did most incidents occur?
          4. **Strategic Recommendations**: What long-term actions should management take based on this data?
          
          Format the output using clear Markdown with bullet points. Do not wrap in JSON.`
        }]
      }
    });

    return response.text || "Could not generate report.";
  } catch (error) {
    console.error("Report Generation Error:", error);
    if ((error as Error).message.includes("UNAUTHORIZED")) return "خطای لایسنس: امکان تولید گزارش وجود ندارد.";
    return "خطا در تولید گزارش هوشمند. کلید API یا اینترنت را بررسی کنید.";
  }
};

export const findNearbyEmergencyServices = async (lat: number, lng: number): Promise<{text: string, chunks: GroundingChunk[]}> => {
  try {
     ensureAuthorized(); // Security Check
     const apiKey = getApiKey();
     if (!apiKey) throw new Error("API Key missing");

     const ai = new GoogleGenAI({ apiKey });
     
     const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: "Find the nearest emergency medical centers (hospitals) and fire stations relative to my location. Provide a brief list with estimated drive times if available. Also look for industrial safety equipment suppliers nearby.",
      config: {
        tools: [{googleMaps: {}}],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng
            }
          }
        }
      },
    });
    
    return {
      text: response.text || "No information found.",
      chunks: (response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[]) || []
    };
  } catch (e) {
    console.error("Maps Grounding Error", e);
    if ((e as Error).message.includes("UNAUTHORIZED")) return { text: "دسترسی غیرمجاز.", chunks: [] };
    return { text: "خطا در دریافت اطلاعات مکانی. کلید API را بررسی کنید.", chunks: [] };
  }
};
