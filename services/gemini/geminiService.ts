
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * 业务 Prompt 模版库
 */
export const PROMPT_TEMPLATES = {
  CONTRACT_EXTRACTION: `作为资深租赁专家，请从合同中提取：合同号、承租方、资产名、起止日期、年度租金、物业费、支付周期、单位类型（关联/外部）。`,
  FINANCIAL_AUDIT: `作为高级审计师，请对比合同约定与财务流水，识别收缴率差异及原因（如预收、欠费）。`,
  DECISION_REPORT: `作为 CFO，请根据合同、财务、资产三方数据，生成经营摘要、风险预警和管理建议。`
};

/**
 * 通用重试封装
 */
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const isRetryable = error?.status === 500 || error?.status === 503 || error?.status === 429;
    if (retries > 0 && isRetryable) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

/**
 * 核心分析服务
 */
export const analyzeLeaseData = async (contracts: any, ledger: any, assets: any) => {
  const prompt = `${PROMPT_TEMPLATES.DECISION_REPORT}\n数据：${JSON.stringify({ contracts, ledger, assets })}`;
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
                properties: { label: { type: Type.STRING }, value: { type: Type.STRING }, status: { type: Type.STRING } } 
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

/**
 * 文档提取服务
 */
export const extractContractFromDoc = async (base64Data: string, mimeType: string) => {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: {
        parts: [{ inlineData: { data: base64Data, mimeType } }, { text: PROMPT_TEMPLATES.CONTRACT_EXTRACTION }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            contractNo: { type: Type.STRING },
            tenantName: { type: Type.STRING },
            assetName: { type: Type.STRING },
            startDate: { type: Type.STRING },
            endDate: { type: Type.STRING },
            annualRent: { type: Type.NUMBER },
            monthlyPropertyFee: { type: Type.NUMBER },
            paymentCycle: { type: Type.STRING },
            type: { type: Type.STRING }
          }
        }
      }
    });
    return JSON.parse(response.text || '{}');
  });
};
