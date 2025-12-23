
import { GoogleGenAI, Type } from "@google/genai";
import { CONTRACT_EXTRACTION_PROMPT, MANAGEMENT_REPORT_PROMPT } from "../../constants/aiPrompts";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
  const prompt = `${MANAGEMENT_REPORT_PROMPT}\n数据上下文：${JSON.stringify({ contracts, ledger, assets })}`;
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{}');
  });
};

export const extractContractFromDoc = async (base64Data: string, mimeType: string) => {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{ inlineData: { data: base64Data, mimeType } }, { text: CONTRACT_EXTRACTION_PROMPT }]
      },
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || '{}');
  });
};
