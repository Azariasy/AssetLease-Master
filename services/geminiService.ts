
import { AnalysisResult } from '../types';

// 配置通义千问 (DashScope) 的 API 端点
// 使用兼容 OpenAI 的接口格式
const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

// Helper to get API Key from localStorage (set in App.tsx)
const getApiKey = () => localStorage.getItem('DASHSCOPE_API_KEY') || '';

// Helper function to call Qwen API
const callQwenAPI = async (messages: any[], model: string = "qwen-plus") => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("缺少通义千问 API Key");

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      response_format: { type: "json_object" } // Force JSON output where possible
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || "DashScope API request failed");
  }

  const data = await response.json();
  return data.choices[0].message.content;
};

// AI 智能对账分析 (通用/合同类 - FinancePage 使用)
export const analyzeReconciliation = async (
  plans: any[], 
  ledger: any[], 
  mismatches: any[]
): Promise<AnalysisResult> => {
  
  const prompt = `
    作为财务审计专家，请分析以下租赁业务的对账数据：
    
    1. 总体应收计划: ${JSON.stringify(plans.length)} 笔
    2. 未匹配记录: ${JSON.stringify(mismatches.slice(0, 10))} (仅展示前10条)
    3. ERP财务流水片段: ${JSON.stringify(ledger.slice(0, 5))}

    请诊断匹配失败的主要原因（如：跨期确认、金额税差、摘要模糊），并给出具体的整改或人工核对建议。

    请严格返回合法的 JSON 格式，结构如下：
    {
      "summary": "简要的分析结论（200字以内）",
      "risks": ["风险点1", "风险点2"],
      "recommendations": ["建议1", "建议2"],
      "kpiIndicators": [
        {"label": "对账匹配率", "value": "63.1%", "status": "warning"}
      ]
    }
  `;

  try {
    const content = await callQwenAPI([
      { role: "system", content: "你是一个专业的财务助手，请始终以纯 JSON 格式回复。" },
      { role: "user", content: prompt }
    ], "qwen-plus");

    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("AI Analysis Failed:", error);
    return {
      summary: "AI 分析服务暂时不可用。",
      risks: [],
      recommendations: ["请检查网络连接"],
      kpiIndicators: []
    };
  }
};

// 关联交易月度趋势分析 (DashboardPage 使用)
export const analyzeInterCompanyRecon = async (
  entityName: string,
  counterpartyName: string,
  breakdown: any[]
): Promise<AnalysisResult> => {
  const relevantMonths = breakdown.filter(m => m.myRev !== 0 || m.theirCost !== 0 || m.status === 'unmatched');
  
  const prompt = `
    背景：我们正在核对 "${entityName}" (我方，确认收入) 与 "${counterpartyName}" (对方，确认成本) 之间的关联交易。
    以下是月度差异明细：${JSON.stringify(relevantMonths)}
    
    请分析差异原因（Diff不为0的月份）：
    1. 寻找规律：是否存在时间性差异？(例如：我方1月确认收入，对方2月才入账成本)
    2. 寻找金额特征：差异金额是否为整数或特定比例（可能是税差）？
    
    请严格返回 JSON：
    {
      "summary": "分析结论（重点解释差异原因）",
      "risks": ["发现的风险点1", "风险点2"],
      "recommendations": ["查账建议1", "查账建议2"],
      "kpiIndicators": []
    }
  `;

  try {
    const content = await callQwenAPI([
      { role: "system", content: "你是一个资深的集团财务审计师。请以 JSON 格式回复。" },
      { role: "user", content: prompt }
    ], "qwen-plus"); 

    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Inter-company Analysis Failed:", error);
    return {
      summary: "智能分析暂时不可用，请稍后重试。",
      risks: ["API 调用失败"],
      recommendations: ["请人工核对"],
      kpiIndicators: []
    };
  }
};

// NEW: 凭证级智能匹配 (DashboardPage 穿透使用)
export const smartVoucherMatch = async (
  myVouchers: any[],
  theirVouchers: any[]
) => {
  // 简化数据以减少 token 消耗
  const simplify = (arr: any[]) => arr.map(v => ({
    id: v.voucherNo,
    date: v.date,
    amount: v.amount,
    summary: v.summary
  }));

  const prompt = `
    任务：核对两组财务凭证（我方收入 vs 对方成本），找出未匹配的项。
    
    【我方凭证列表】:
    ${JSON.stringify(simplify(myVouchers))}

    【对方凭证列表】:
    ${JSON.stringify(simplify(theirVouchers))}

    匹配规则：
    1. 金额完全一致（或相差 0.01 以内）。
    2. 或者：金额相差 6% 或 9%（可能是税额差异），且摘要高度相关。
    
    请返回 JSON：
    {
      "matchedPairs": [ {"myId": "...", "theirId": "...", "note": "金额匹配"} ],
      "unmatchedMySide": ["凭证号1", "凭证号2"],
      "unmatchedTheirSide": ["凭证号A"],
      "analysis": "简短分析差异原因，例如：'对方缺少一笔 5000 元的物业费入账'。"
    }
  `;

  try {
    const content = await callQwenAPI([
      { role: "system", content: "你是一个精通审计的AI助手，擅长发现凭证之间的勾稽关系。" },
      { role: "user", content: prompt }
    ], "qwen-plus");

    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Voucher Match Failed:", error);
    return {
      matchedPairs: [],
      unmatchedMySide: [],
      unmatchedTheirSide: [],
      analysis: "AI 匹配失败，请人工核对。"
    };
  }
};


// NEW: 财务异常波动检测 (DashboardPage 趋势分析使用)
export const detectFinancialAnomalies = async (
  entityName: string,
  trendData: any[]
) => {
  const prompt = `
    任务：作为CFO助手，请分析 "${entityName}" 的月度财务趋势，识别异常波动。
    
    【月度数据】:
    ${JSON.stringify(trendData)}

    请识别：
    1. 收入或成本环比波动超过 30% 的月份。
    2. 利润率为负或极低的月份。
    3. 长期趋势中的离群点。

    请返回 JSON：
    {
      "anomalies": [
        {
          "period": "2024-02", 
          "type": "cost_spike", 
          "level": "high",
          "description": "成本环比激增 50%，可能存在大额偶发性支出"
        }
      ],
      "summary": "一句话整体评价 (如：上半年经营稳健，但5月成本控制需关注)"
    }
  `;

  try {
    const content = await callQwenAPI([
      { role: "system", content: "你是一个敏锐的财务数据分析师。请以 JSON 格式回复。" },
      { role: "user", content: prompt }
    ], "qwen-plus");

    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Anomaly Detection Failed:", error);
    return {
      anomalies: [],
      summary: "AI 分析服务暂时不可用。"
    };
  }
};


// AI 合同提取
export const extractContractData = async (base64Content: string, mimeType: string) => {
  const prompt = `
    请解析这份租赁合同图片，提取以下关键字段用于财务台账系统：
    - 合同编号 (contractNo)
    - 承租方名称 (tenantName)
    - 业务类型 (type): '房屋租赁' 或 '物业服务'
    - 租金/费用金额 (amount): 提取明确的数字
    - 支付周期 (paymentCycle): 月度/季度/年度
    - 租赁起止日期 (startDate, endDate): 格式 YYYY-MM-DD
    - 是否关联方 (isRelated): 根据承租方名称判断 (如含'移动'或'研究院'字样)

    请严格返回合法的 JSON 格式，不要包含 Markdown 格式标记。
  `;

  const dataUrl = `data:${mimeType};base64,${base64Content}`;

  try {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: prompt }
        ]
      }
    ];

    const content = await callQwenAPI(messages, "qwen-vl-max");
    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);

  } catch (error) {
    console.error("Contract Extraction Failed:", error);
    throw error;
  }
};

// NEW: 自然语言查询解析 (LedgerPage NLQ Search)
export const parseNaturalLanguageQuery = async (query: string, validPeriods: string[] = []) => {
  const prompt = `
    任务：将用户的自然语言查询解析为财务流水账的筛选条件。
    
    查询内容: "${query}"
    
    系统当前存在的会计期间 (Valid Periods): ${JSON.stringify(validPeriods)}
    
    请提取以下字段（JSON格式）：
    - period: 会计期间 (YYYY-MM)。
      规则：如果用户提到月份（如“12月”），必须优先在 Valid Periods 中寻找匹配的年份（如 '2024-12'）。
      如果用户没有提到时间，返回空字符串。
    - subjectCode: 科目代码 (纯数字)。如果提到具体科目但无代码，可留空。
    - keyword: 搜索关键词。用于匹配摘要、往来单位、金额等。请提取公司名、业务名等核心词。

    示例 1：
    Valid Periods: ["2023-12", "2024-01"]
    用户: "查一下12月的研发费用"
    返回: { "period": "2023-12", "subjectCode": "", "keyword": "研发费用" }

    示例 2：
    Valid Periods: ["2024-11", "2024-12"]
    用户: "成都燃气公司的往来账"
    返回: { "period": "", "subjectCode": "", "keyword": "成都燃气" }
  `;

  try {
    const content = await callQwenAPI([
      { role: "system", content: "你是一个精确的语义解析助手，只返回 JSON。" },
      { role: "user", content: prompt }
    ], "qwen-plus");

    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    const result = JSON.parse(jsonStr);
    return {
        period: result.period || '',
        subjectCode: result.subjectCode || '',
        keyword: result.keyword || ''
    };
  } catch (error) {
    console.error("NLQ Failed:", error);
    // Fallback
    return { period: '', subjectCode: '', keyword: query };
  }
};

// NEW: 生成自然语言回复
export const generateNlqResponse = async (query: string, stats: any) => {
  const prompt = `
    任务：根据用户查询和系统查到的财务数据统计，生成一句简洁、友好的回答。
    
    用户问题: "${query}"
    查得数据统计: ${JSON.stringify(stats)}
    
    字段说明：
    - count: 记录条数
    - totalDebit: 借方合计
    - totalCredit: 贷方合计
    - summaries: 主要的摘要内容（前几条）

    要求：
    1. 直接回答结果。例如：“找到了 3 笔相关记录，主要是支付燃气费，合计 2000 元。”
    2. 如果没查到（count=0），请礼貌告知。
    3. 不要返回 JSON，只返回文本字符串。
  `;

  try {
    const content = await callQwenAPI([
      { role: "system", content: "你是一个乐于助人的财务机器人。" },
      { role: "user", content: prompt }
    ], "qwen-plus");

    return content.replace(/['"]/g, ''); // Simple cleanup
  } catch (error) {
    return `查询完成，共找到 ${stats.count} 条记录。`;
  }
};
