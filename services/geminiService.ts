
import { GoogleGenAI, Type } from "@google/genai";

const PROMPT_TEMPLATES = {
  CONTRACT_EXTRACTION: `
    作为资深法务与租赁专家，请从合同中提取核心要素。
    特别注意：
    - 识别关联方关系（中移、移动等关键词）。
    - 区分房屋租金与物业费。
    - 提取准确的免租期或递增条款（若有）。
  `,
  FINANCIAL_AUDIT: `
    作为高级审计师，请对比合同约定与财务明细。
    分析重点：
    - 租金收缴率。
    - 跨期入账原因推测（如：季度预收、补交欠费）。
    - 科目归集准确性（1131/2401/5171）。
  `,
  MANAGEMENT_REPORT: `
    作为首席财务官(CFO)，请生成管理决策建议。
    要求：
    - 语言专业、精炼。
    - 识别出具体的财务风险（如：对关联方过度依赖、物业费亏损）。
    - 提供可落地的改进措施。
  `
};

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

export const analyzeLeaseData = async (contracts: any, ledger: any, assets: any) => {
  // Create a new GoogleGenAI instance right before making an API call to ensure it always uses the most up-to-date API key.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `
    ${PROMPT_TEMPLATES.MANAGEMENT_REPORT}
    基础数据：
    合同: ${JSON.stringify(contracts)}
    流水: ${JSON.stringify(ledger)}
    资产: ${JSON.stringify(assets)}
    请严格返回 JSON。
  `;

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
                  status: { type: Type.STRING, description: "success, warning, error" } 
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
          },
          required: ["contractNo", "tenantName", "annualRent"]
        }
      }
    });
    return JSON.parse(response.text || '{}');
  });
};
