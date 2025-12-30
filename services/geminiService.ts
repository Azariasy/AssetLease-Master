
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// AI 智能对账分析
export const analyzeReconciliation = async (
  plans: any[], 
  ledger: any[], 
  mismatches: any[]
): Promise<AnalysisResult> => {
  const prompt = `
    作为财务审计专家，请分析以下非上市主体租赁业务的对账数据：
    
    1. 总体应收计划: ${JSON.stringify(plans.length)} 笔
    2. 未匹配记录: ${JSON.stringify(mismatches.slice(0, 10))} (仅展示前10条)
    3. ERP财务流水片段: ${JSON.stringify(ledger.slice(0, 5))}

    请诊断匹配失败的主要原因（如：跨期确认、金额税差、摘要模糊），并给出具体的整改或人工核对建议。
    特别关注关联方交易的合规性。

    请返回JSON格式：
    {
      "summary": "简要的分析结论（200字以内）",
      "risks": ["风险点1", "风险点2"],
      "recommendations": ["建议1", "建议2"],
      "kpiIndicators": [
        {"label": "对账匹配率", "value": "63.1%", "status": "warning"},
        {"label": "关联方异常", "value": "0笔", "status": "success"}
      ]
    }
  `;

  try {
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
          required: ["summary", "risks", "recommendations"]
        }
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("AI Analysis Failed:", error);
    // 返回兜底数据
    return {
      summary: "AI 服务暂时不可用，请检查网络连接或 API Key。",
      risks: ["无法进行智能风险扫描"],
      recommendations: ["请人工核对未匹配项目"],
      kpiIndicators: []
    };
  }
};

// AI 合同提取 (模拟 v2.0 需求)
export const extractContractData = async (base64Content: string, mimeType: string) => {
  const prompt = `
    请解析这份租赁合同，提取以下关键字段用于财务台账系统：
    - 合同编号 (contractNo)
    - 承租方名称 (tenantName)
    - 业务类型 (type): '房屋租赁' 或 '物业服务'
    - 租金/费用金额 (amount): 提取明确的数字
    - 支付周期 (paymentCycle): 月度/季度/年度
    - 租赁起止日期 (startDate, endDate)
    - 是否关联方 (isRelated): 根据承租方名称判断 (如含'移动')

    返回 JSON 格式。
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: {
      parts: [
        { inlineData: { data: base64Content, mimeType } },
        { text: prompt }
      ]
    },
    config: { responseMimeType: "application/json" }
  });
  
  return JSON.parse(response.text || '{}');
};
