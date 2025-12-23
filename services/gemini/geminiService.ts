
import { GoogleGenAI, Type } from "@google/genai";
import { CONTRACT_EXTRACTION_PROMPT, MANAGEMENT_REPORT_PROMPT } from "../../constants/aiPrompts";

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && (error?.status === 500 || error?.status === 429)) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const analyzeLeaseData = async (contracts: any, ledger: any, assets: any) => {
  // Create a new GoogleGenAI instance right before making an API call to ensure it always uses the most up-to-date API key.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `${MANAGEMENT_REPORT_PROMPT}\n数据上下文：${JSON.stringify({ contracts, ledger, assets })}`;
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            risks: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            kpiIndicators: { 
              type: Type.ARRAY, 
              items: { 
                type: Type.OBJECT, 
                properties: { 
                  label: { type: Type.STRING }, 
                  value: { type: Type.STRING }, 
                  status: { type: Type.STRING } 
                } 
              } 
            }
          },
          required: ["summary", "risks", "recommendations", "kpiIndicators"]
        }
      }
    });
    return JSON.parse(response.text || '{}');
  });
};

export const extractContractFromDoc = async (base64Data: string, mimeType: string) => {
  // Create a new GoogleGenAI instance right before making an API call to ensure it always uses the most up-to-date API key.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{ inlineData: { data: base64Data, mimeType } }, { text: CONTRACT_EXTRACTION_PROMPT }]
      },
      config: { 
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            contractNo: { type: Type.STRING },
            tenantName: { type: Type.STRING },
            type: { type: Type.STRING, description: "关联方 或 外部单位" },
            startDate: { type: Type.STRING },
            endDate: { type: Type.STRING },
            annualRent: { type: Type.NUMBER },
            monthlyPropertyFee: { type: Type.NUMBER },
            paymentCycle: { type: Type.STRING },
            deposit: { type: Type.NUMBER }
          },
          required: ["contractNo", "tenantName", "annualRent"]
        }
      }
    });
    return JSON.parse(response.text || '{}');
  });
};
