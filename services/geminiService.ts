import { GoogleGenAI, Type, Schema } from "@google/genai";
import { SafetyAnalysis } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const analysisSchema: Schema = {
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
          severity: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW", "SAFE"] },
          description: { type: Type.STRING, description: "Description of the hazard in Persian (Farsi)." },
          recommendation: { type: Type.STRING, description: "Immediate corrective action in Persian (Farsi)." },
          box_2d: { 
            type: Type.ARRAY, 
            description: "Bounding box coordinates [ymin, xmin, ymax, xmax] on a 1000x1000 scale for the detected hazard.",
            items: { type: Type.INTEGER }
          }
        },
        required: ["type", "severity", "description", "recommendation", "box_2d"],
      },
    },
  },
  required: ["safetyScore", "isSafe", "summary", "hazards"],
};

export const analyzeSafetyImage = async (base64Image: string): Promise<SafetyAnalysis> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
            3. Determine a safety score based on visual evidence.`,
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
    // Return a fallback error state so the UI doesn't crash
    return {
      timestamp: new Date().toLocaleTimeString(),
      safetyScore: 0,
      isSafe: false,
      summary: "Error connecting to AI Safety Officer. Please check connection.",
      hazards: [],
    };
  }
};