
/**
 * 资产租赁系统专用 Prompt 模版
 */
export const CONTRACT_EXTRACTION_PROMPT = `
你是一个专业的租赁合同解析专家。请从以下合同文本中提取关键信息：
- contractNo: 合同编号
- tenantName: 出租方/承租方（全称）
- type: 是否关联方（识别关键字：中移、移动、咪咕等为关联方，否则为外部单位）
- startDate: 起租日期 (YYYY-MM-DD)
- endDate: 终止日期 (YYYY-MM-DD)
- annualRent: 年度房屋租金（不含税总额，仅数字）
- monthlyPropertyFee: 月度物业管理费（不含税，仅数字）
- paymentCycle: 付款周期（月付/季付/半年付等）
- deposit: 押金金额 (仅数字)
- utilitiesTerms: 水电气代收代付约定简述
- unitList: 出租单元列表（楼栋-楼层-房间号）
输出严格 JSON 格式，不要多余文字。
`;

export const MANAGEMENT_REPORT_PROMPT = `
作为首席财务官(CFO)，请根据提供的合同台账、财务科目余额和资产分布，生成一份经营深度研判报告。
要求包含：
1. summary: 100字以内的核心经营结论。
2. risks: 识别 3-5 个具体的财务、收缴或空置风险。
3. recommendations: 提供 3 个可落地的管理建议。
4. kpiIndicators: 包含收缴率、关联方收入占比、物业利润覆盖率、欠费天数预警。
输出严格 JSON 格式。
`;
