
import { AnalysisResult, SystemConfig } from '../types';

// 配置通义千问 (DashScope) 的 API 端点
// 使用兼容 OpenAI 的接口格式
const BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

// Helper to get API Key from localStorage (set in App.tsx) or env
const getApiKey = () => {
  return localStorage.getItem('DASHSCOPE_API_KEY') || 
         (window as any).DASHSCOPE_API_KEY || 
         ''; 
};

// Helper function to call Qwen API
const callQwenAPI = async (messages: any[], model: string = "qwen-plus", jsonMode: boolean = false) => {
  const apiKey = getApiKey();
  // Don't throw immediately, let the caller handle the fallback if key is missing
  if (!apiKey) throw new Error("Missing API Key");

  const body: any = {
    model: model,
    messages: messages,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch(BASE_URL, {
        method: "POST",
        headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "DashScope API request failed");
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
      throw err;
  }
};

// --- Local Fallback Logic (Rule-based) ---
const localNlqFallback = (query: string, validPeriods: string[]) => {
  let period = '';
  let category: 'income' | 'cost' | null = null;
  let keyword = query;
  let isAggregation = false;

  // 1. Extract Period (Year) - e.g., 2025, 2024
  const yearMatch = keyword.match(/(20\d{2})/);
  if (yearMatch) {
      period = yearMatch[1];
      // If validPeriods contains this year, finding the exact match is handled by filter, 
      // but here we just extracting the string "2025"
      keyword = keyword.replace(yearMatch[0], '').replace('年', '');
  }

  // 2. Extract Month - e.g., 12月, 1月
  const monthMatch = keyword.match(/(\d{1,2})月/);
  if (monthMatch) {
      const m = monthMatch[1].padStart(2, '0');
      // Attempt to construct YYYY-MM if we already have a year
      if (period.length === 4) {
          period = `${period}-${m}`;
      } else {
          // Try to find the most recent matching period from validPeriods
          const match = validPeriods.find(p => p.endsWith(`-${m}`));
          if (match) period = match;
      }
      keyword = keyword.replace(monthMatch[0], '');
  }

  // 3. Extract Category
  if (/收入|营收|收益|赚|进账/.test(keyword)) {
      category = 'income';
      keyword = keyword.replace(/收入|营收|收益|赚|进账/g, '');
  } else if (/成本|费用|支出|花销|开支|付款/.test(keyword)) {
      category = 'cost';
      keyword = keyword.replace(/成本|费用|支出|花销|开支|付款/g, '');
  }

  // 4. Aggregation intent
  if (/多少|合计|总额|总共|统计/.test(keyword)) {
      isAggregation = true;
      keyword = keyword.replace(/多少|合计|总额|总共|统计|钱|金额/g, '');
  }

  // 5. Cleanup keyword (Remove stop words and particles)
  // This is crucial to prevent "在" or "有哪些" from becoming the search keyword which yields 0 results.
  keyword = keyword
    .replace(/查一下|查询|看看|搜索|有没有|有哪些|的|是|在|或者|和|与/g, ' ')
    .trim();

  // 6. Handle Company Names specifically if recognized structure
  // (Simple heuristic: if keyword is still long, it might be a company name)
  
  return { period, category, subjectCode: '', keyword, isAggregation };
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
    ], "qwen-plus", true);

    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("AI Analysis Failed:", error);
    return {
      summary: "AI 分析服务暂时不可用（API Key 未配置或网络错误）。",
      risks: [],
      recommendations: ["请检查网络连接", "请在设置页配置 API Key"],
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
    ], "qwen-plus", true); 

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
    ], "qwen-plus", true);

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
    ], "qwen-plus", true);

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

    // Vision model does not support response_format parameter usually, or we default it to false/auto
    const content = await callQwenAPI(messages, "qwen-vl-max", false);
    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(jsonStr);

  } catch (error) {
    console.error("Contract Extraction Failed:", error);
    throw error;
  }
};

// NEW: 自然语言查询解析 (LedgerPage NLQ Search) - 增强版 v4.1
export const parseNaturalLanguageQuery = async (query: string, validPeriods: string[], config: SystemConfig) => {
  const prompt = `
    任务：将用户的自然语言查询解析为财务流水账的筛选条件。
    
    查询内容: "${query}"
    
    【上下文信息】:
    1. 系统当前存在的会计期间: ${JSON.stringify(validPeriods)}
    2. 收入类科目规则: 代码以 ${JSON.stringify(config.incomeSubjectCodes)} 开头。
    3. 成本/费用类科目规则: 代码以 ${JSON.stringify(config.costSubjectCodes)} 开头。
    
    【解析规则】:
    1. **Period (会计期间)**: 
       - 如果用户说 "2025年" 或 "今年"，请提取为 "2025" (fuzzy match)。
       - 如果说 "12月" 且上下文有 2024-12，则提取 "2024-12"。
       - 如果未提及，留空。
    2. **Category (科目类别)**:
       - 如果用户问 "收入"、"营收"、"赚钱"，返回 "income"。
       - 如果用户问 "成本"、"费用"、"支出"、"花销"，返回 "cost"。
       - 否则返回 null。
    3. **SubjectCode (具体科目)**: 
       - 如果用户提到具体数字代码 (如 5502)，提取它。
    4. **Keyword (关键词)**: 
       - 提取核心搜索词（如往来单位名称、部门名称、摘要内容）。
       - **重要**: 请务必**排除**询问词（如“有多少”、“查一下”、“有哪些”）和时间/类别词，只保留实体名称或业务关键词。
       - 示例："查询成都移动2025年的收入" -> Keyword: "成都移动" (排除"查询","2025","收入")。
    5. **Aggregation (意图)**:
       - 如果用户是在问 "多少钱"、"总额"、"合计"，设置 isAggregation=true。

    请返回 JSON:
    {
      "period": "string", 
      "category": "income" | "cost" | null,
      "subjectCode": "string",
      "keyword": "string",
      "isAggregation": boolean
    }
  `;

  try {
    const content = await callQwenAPI([
      { role: "system", content: "你是一个精确的财务语义解析助手，只返回 JSON。" },
      { role: "user", content: prompt }
    ], "qwen-plus", true);

    const jsonStr = content.replace(/```json\n?|```/g, '').trim();
    const result = JSON.parse(jsonStr);
    return {
        period: result.period || '',
        category: result.category || null,
        subjectCode: result.subjectCode || '',
        keyword: result.keyword || '',
        isAggregation: result.isAggregation || false
    };
  } catch (error) {
    console.warn("NLQ API Failed, using local fallback rule-based parser.", error);
    // Use the robust local fallback instead of returning raw query as keyword
    return localNlqFallback(query, validPeriods);
  }
};

// NEW: 生成自然语言回复 - 增强版 v4.1 (支持回答具体数值)
export const generateNlqResponse = async (query: string, stats: any, context?: any) => {
  const prompt = `
    任务：根据用户查询和系统查到的财务数据，生成一句专业、准确的回答。
    
    用户问题: "${query}"
    
    【查得数据统计】:
    - 记录条数: ${stats.count}
    - 借方合计: ${stats.totalDebit}
    - 贷方合计: ${stats.totalCredit}
    - 摘要示例: ${JSON.stringify(stats.summaries)}
    
    【上下文判断】:
    - 查询类别: ${context?.category || '通用搜索'}
    - 涉及期间: ${context?.period || '全部'}
    
    【回答要求】:
    1. 如果用户问的是"收入" (Income)，请重点回答**贷方合计**金额。
    2. 如果用户问的是"成本/费用" (Cost)，请重点回答**借方合计**金额。
    3. 如果是通用查询，简述借贷情况。
    4. 如果没有数据 (count=0)，请礼貌告知。
    5. **直接回答数字**，不要只说"找到了记录"。例如："2025年共产生收入 1,200,000 元。"
    6. 只返回文本字符串，不要 JSON。
  `;

  try {
    // Pass false to disable JSON mode, as we want plain text response
    const content = await callQwenAPI([
      { role: "system", content: "你是一个乐于助人的财务机器人，说话简练、专业。" },
      { role: "user", content: prompt }
    ], "qwen-plus", false);

    return content.replace(/['"]/g, ''); 
  } catch (error) {
    // If text generation fails, return a template response
    let msg = `查询完成，共找到 ${stats.count} 条记录。`;
    if (context?.category === 'income') msg += ` 贷方合计: ${stats.totalCredit}`;
    else if (context?.category === 'cost') msg += ` 借方合计: ${stats.totalDebit}`;
    return msg;
  }
};
