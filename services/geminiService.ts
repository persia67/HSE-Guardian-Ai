import { GoogleGenAI, Type, Schema } from "@google/genai";
import { SafetyAnalysis, LogEntry, GroundingChunk } from "../types";

// Initialization moved inside functions to prevent global scope crash if process is undefined
// const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

export const analyzeSafetyImage = async (base64Image: string): Promise<SafetyAnalysis> => {
  try {
    // Initialize AI client lazily. This ensures the app renders even if env vars are problematic at startup.
    // The try-catch block will handle any configuration errors gracefully.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
    // Return a fallback error state so the UI doesn't crash
    return {
      timestamp: new Date().toLocaleTimeString(),
      safetyScore: 0,
      isSafe: false,
      summary: "Error connecting to AI Safety Officer. Please check connection and API Key configuration.",
      hazards: [],
    };
  }
};

export const generateSessionReport = async (logs: LogEntry[]): Promise<string> => {
  try {
    // Initialize AI client lazily
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Filter out heavy base64 images before sending to text model to save tokens
    const textLogs = logs.map(({ thumbnail, ...rest }) => rest);
    
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", // Using Pro for complex reasoning and summarization
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
          
          Format the output using clear Markdown with bullet points.`
        }]
      }
    });

    return response.text || "Could not generate report.";
  } catch (error) {
    console.error("Report Generation Error:", error);
    return "Error generating AI report. Please try again.";
  }
};

export const findNearbyEmergencyServices = async (lat: number, lng: number): Promise<{text: string, chunks: GroundingChunk[]}> => {
  try {
     const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
     const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: "Find the nearest emergency medical centers (hospitals) and fire stations. Provide a brief list with estimated drive times if available. Also look for industrial safety equipment suppliers.",
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
    return { text: "Error retrieving location data or connecting to service.", chunks: [] };
  }
};