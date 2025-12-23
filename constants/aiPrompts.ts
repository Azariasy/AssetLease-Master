
/**
 * 资产租赁系统专用 Prompt 模版
 */
export const CONTRACT_EXTRACTION_PROMPT = `
你是一个专业的租赁合同解析专家。请从合同文本中提取：
- contractNo: 合同编号
- tenantName: 承租方全称
- assetName: 租赁标的物名称
- startDate/endDate: 起止日期 (YYYY-MM-DD)
- annualRent: 年度总租金 (仅数字)
- monthlyPropertyFee: 月度物业管理费 (仅数字)
- paymentCycle: 支付周期 (月度/季度/年度)
- type: 承租方类型 (识别 '中移'、'移动'、'产业园' 为关联方，否则为外部单位)
输出严格 JSON 格式。
`;

export const MANAGEMENT_REPORT_PROMPT = `
作为首席财务官(CFO)，请根据提供的合同、财务流水和资产状态数据，生成深度经营分析报告。
需包含：
1. summary: 100字以内的核心经营结论。
2. risks: 识别 3-5 个具体的财务或运营风险点。
3. recommendations: 提供 3 个可落地的管理建议。
4. kpiIndicators: 提取关键 KPI（如收缴率、关联方占比等），并附带状态(success/warning/error)。
输出严格 JSON 格式。
`;
