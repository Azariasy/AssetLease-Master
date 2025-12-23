
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Utility for exponential backoff retry logic
 */
const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const isRetryable = error?.status === 500 || error?.status === 503 || error?.status === 429;
    if (retries > 0 && isRetryable) {
      console.warn(`API Error (${error?.status}). Retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

/**
 * AI-powered lease data analysis for management reporting
 */
export const analyzeLeaseData = async (contracts: any, ledger: any, assets: any) => {
  const prompt = `
    作为一名资深财务分析师，请根据以下数据进行综合分析：
    合同数据: ${JSON.stringify(contracts)}
    财务明细: ${JSON.stringify(ledger)}
    资产状态: ${JSON.stringify(assets)}

    请从收入完成情况、资产利用率、异常风险、汇报金句四个维度给出中文分析。
    必须严格返回 JSON 格式。
  `;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", // Upgraded to Pro for complex multi-dimensional analysis
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "综合分析摘要" },
            risks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "识别出的潜在风险点" },
            recommendations: { type: Type.ARRAY, items: { type: Type.STRING }, description: "改进建议" },
          },
          required: ["summary", "risks", "recommendations"]
        }
      }
    });
    
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini API");
    return JSON.parse(text);
  });
};

/**
 * Extract contract elements from documents (PDF/Word/Images) using Multimodal LLM
 */
export const extractContractFromDoc = async (base64Data: string, mimeType: string) => {
  const prompt = `
    请仔细研读上传的合同文档，准确提取以下关键业务要素并以 JSON 格式返回。
    如果文档中有多个金额，请提取“年度租金”或“基础租金总额”。
    
    字段定义：
    1. contractNo: 合同编号
    2. tenantName: 承租方全称
    3. assetName: 租赁标的物/房屋名称
    4. startDate: 租期开始日期 (YYYY-MM-DD)
    5. endDate: 租期结束日期 (YYYY-MM-DD)
    6. annualRent: 年度总租金 (仅数字)
    7. monthlyPropertyFee: 月度物业管理费 (仅数字，若无则为 0)
    8. paymentCycle: 支付周期 (必须为：月度、季度、年度)
    9. type: 承租方类型 (若是关联单位返回'关联方'，否则返回'外部单位')
  `;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", // Upgraded to Pro for better accuracy on complex legal document extraction
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: prompt }
        ]
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
          required: ["contractNo", "tenantName", "assetName", "startDate", "endDate", "annualRent", "paymentCycle", "type"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty extraction response from Gemini API");
    return JSON.parse(text);
  });
};
