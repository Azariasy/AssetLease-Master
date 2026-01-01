
import { AnalysisResult, SystemConfig, KnowledgeChunk, LedgerRow, ComplianceResult } from '../types';
import { db } from '../db';

// DeepSeek API Configuration
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_EMBED_URL = "https://api.deepseek.com/embeddings"; 
const MODEL_CHAT = "deepseek-chat";
// const MODEL_REASONER = "deepseek-reasoner"; 

// Helper: Get API Key from LocalStorage Config
const getApiKey = (): string => {
    try {
        const configStr = localStorage.getItem('sys_config');
        if (configStr) {
            const config = JSON.parse(configStr);
            if (config.aiApiKey) return config.aiApiKey;
        }
    } catch (e) { console.error(e); }
    return '';
};

// Helper: Clean JSON string from Markdown wrappers
const cleanJsonString = (str: string) => {
    return str.replace(/```json\n?|```/g, '').trim();
};

// ==========================================
// 1. Core API Wrappers (DeepSeek Implementation)
// ==========================================

const callAI = async (prompt: string, systemInstruction?: string, jsonMode: boolean = false) => {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("DeepSeek API Key 未配置，请在【系统参数】中设置。");

    try {
        const messages = [
            { role: "system", content: systemInstruction || "You are a helpful financial assistant." },
            { role: "user", content: prompt }
        ];

        const body: any = {
            model: MODEL_CHAT,
            messages: messages,
            temperature: 0.1, 
            stream: false
        };

        if (jsonMode) {
            body.response_format = { type: "json_object" };
        }

        const response = await fetch(DEEPSEEK_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMsg = `API Error ${response.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                errorMsg = errorJson.error?.message || errorText;
            } catch {
                errorMsg = errorText;
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || '';

    } catch (e: any) {
        console.error("DeepSeek Call Failed:", e);
        throw new Error(`AI Service Error: ${e.message}`);
    }
};

// Generate Embeddings using DeepSeek (OpenAI Compatible) with Batching
export const getEmbeddings = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key Missing");

    const BATCH_SIZE = 10; // Process in small batches to avoid timeouts/payload limits
    const allEmbeddings: number[][] = [];

    // Helper to pause execution
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        
        try {
            const response = await fetch(DEEPSEEK_EMBED_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "deepseek-embedding",
                    input: batch
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                let errorMsg = `Status ${response.status}`;
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMsg = errorJson.error?.message || errorText;
                } catch {
                    errorMsg = errorText;
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            
            if (!data.data || !Array.isArray(data.data)) {
                throw new Error("Invalid response format from Embedding API");
            }

            // Ensure order is preserved based on 'index' field usually returned by OpenAI-compatible APIs
            const batchEmbeddings = data.data
                .sort((a: any, b: any) => a.index - b.index)
                .map((item: any) => item.embedding);
            
            allEmbeddings.push(...batchEmbeddings);

            // Simple rate limit protection
            if (i + BATCH_SIZE < texts.length) await delay(100);

        } catch (e: any) {
            console.error(`Embedding Batch ${i} Failed:`, e);
            throw new Error(`Embedding API Failed: ${e.message}`);
        }
    }

    return allEmbeddings;
};

// ==========================================
// 2. Vector Utilities (Client-Side)
// ==========================================

const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if(!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0.0, normA = 0.0, normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
};

// RAG Search
const searchKnowledgeBase = async (query: string, topK: number = 3): Promise<{ chunk: KnowledgeChunk, score: number }[]> => {
    try {
        const [queryVec] = await getEmbeddings([query]);
        const allChunks = await db.chunks.toArray();
        if (allChunks.length === 0) return [];

        const validChunks = allChunks.filter(c => c.embedding.length === queryVec.length);
        
        const scored = validChunks.map(chunk => ({
            chunk,
            score: cosineSimilarity(queryVec, chunk.embedding)
        }));

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    } catch (e) {
        console.error("Vector search failed:", e);
        return [];
    }
};

// ==========================================
// 3. Knowledge Ingestion Pipeline
// ==========================================

const chunkText = (text: string, title: string): string[] => {
    // Normalize newlines
    const cleanText = text.replace(/\r\n/g, '\n');
    
    // Split strategy: Prefer headers, fallback to paragraphs, enforce max length
    const MAX_CHUNK_LENGTH = 1500; // Safe limit for embeddings
    const chunks: string[] = [];

    // 1. Try split by Headers (#)
    let initialSegments = cleanText.split(/(^#+ .+$)/gm).filter(t => t.trim().length > 20);
    
    // If header split didn't produce much structure, fallback to double newline
    if (initialSegments.length <= 1) {
        initialSegments = cleanText.split(/\n\s*\n/);
    }

    // 2. Refine Segments (Merge small, split large)
    let currentBuffer = "";

    for (const segment of initialSegments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        // If single segment is huge, split it by sentence or hard limit
        if (trimmed.length > MAX_CHUNK_LENGTH) {
            // Flush buffer first
            if (currentBuffer) {
                chunks.push(currentBuffer);
                currentBuffer = "";
            }
            
            // Split huge segment
            let temp = trimmed;
            while (temp.length > 0) {
                let cutIndex = Math.min(temp.length, MAX_CHUNK_LENGTH);
                // Try to find a sentence break or newline near the limit
                if (cutIndex < temp.length) {
                    const lastPeriod = temp.lastIndexOf('。', cutIndex);
                    const lastNewline = temp.lastIndexOf('\n', cutIndex);
                    const safeCut = Math.max(lastPeriod, lastNewline);
                    if (safeCut > cutIndex * 0.5) cutIndex = safeCut + 1; 
                }
                chunks.push(temp.substring(0, cutIndex));
                temp = temp.substring(cutIndex);
            }
        } 
        // Accumulate buffer
        else if ((currentBuffer.length + trimmed.length) > MAX_CHUNK_LENGTH) {
            chunks.push(currentBuffer);
            currentBuffer = trimmed;
        } else {
            currentBuffer = currentBuffer ? currentBuffer + "\n" + trimmed : trimmed;
        }
    }
    
    if (currentBuffer) chunks.push(currentBuffer);
    
    return chunks;
};

export const ingestDocument = async (docId: string, title: string, content: string, progressCallback?: (stage: string) => void) => {
    if(progressCallback) progressCallback("正在进行语义切片 (Chunking)...");
    const textSegments = chunkText(content, title);
    
    if (textSegments.length === 0) {
        return { summary: "文档内容为空或无法识别", entities: [] };
    }
    
    // Keyword Extraction (Graph)
    if(progressCallback) progressCallback("正在构建知识图谱实体...");
    const summaryPrompt = `
      请提取本文档的核心实体（部门、费用类型、业务名词）和摘要。
      文档内容片段：${content.substring(0, 3000)}...
      请务必只返回标准的 JSON 格式，不要包含Markdown标记。
      格式: { "summary": "精炼摘要...", "entities": ["研发部", "差旅费", ...] }
    `;
    
    let summaryData = { summary: "解析失败", entities: [] };
    try {
        const summaryResStr = await callAI(summaryPrompt, "You are a JSON generator.", true);
        summaryData = JSON.parse(cleanJsonString(summaryResStr));
    } catch (e: any) {
        console.warn("Summary generation warning:", e);
        // Fallback
        summaryData = { summary: content.substring(0, 200) + "...", entities: [] };
    }

    // Embedding
    if(progressCallback) progressCallback(`正在生成向量索引 (DeepSeek, ${textSegments.length} 个切片)...`);
    try {
        const embeddings = await getEmbeddings(textSegments);
        
        // Save Chunks
        const chunks: KnowledgeChunk[] = textSegments.map((seg, idx) => ({
            id: `${docId}-c${idx}`,
            documentId: docId,
            content: seg,
            embedding: embeddings[idx],
            sourceTitle: title,
            tags: summaryData.entities || []
        }));

        await db.chunks.bulkAdd(chunks);

        return summaryData;
    } catch (e: any) {
        console.error("Ingest failed", e);
        throw e; // Propagate error to UI
    }
};

export const processKnowledgeDocument = async (fileName: string, content: string): Promise<{summary: string, entities: string[]}> => {
    return { summary: "Processing handled by ingestDocument", entities: [] };
};

// ==========================================
// 4. RAG-Enhanced Features
// ==========================================

export const parseNaturalLanguageQuery = async (query: string, validPeriods: string[], config: SystemConfig) => {
  const results = await searchKnowledgeBase(query, 3);
  const relevantChunks = results.map(r => r.chunk);
  const context = relevantChunks.map(c => `[来自: ${c.sourceTitle}] ${c.content}`).join("\n\n");

  const prompt = `
    任务：将用户的自然语言查询解析为财务筛选条件。
    查询: "${query}"
    【知识库参考 (RAG)】: ${context.substring(0, 1000)}...
    【数据范围】: ${JSON.stringify(validPeriods)}
    【逻辑】: 收入(5xxx, 客户), 成本(54xx/66xx, 供应商), 资产(16xx/19xx).
    返回 JSON: { "period", "category": "income"|"cost"|"asset", "subjectCode", "keyword", "isAggregation" }
  `;

  try {
    const content = await callAI(prompt, "你是一个精准的财务语义解析助手，只返回 JSON。", true);
    return JSON.parse(cleanJsonString(content));
  } catch (error) {
    console.warn("NLQ API Failed", error);
    return { period: '', category: null, subjectCode: '', keyword: query, isAggregation: false };
  }
};

export const generateNlqResponse = async (query: string, stats: any, context?: any) => {
  const results = await searchKnowledgeBase(query, 2);
  const relevantChunks = results.map(r => r.chunk);
  const ragContext = relevantChunks.map(c => `依据 "${c.sourceTitle}": ${c.content}`).join("\n");

  const prompt = `
    任务：作为财务专家回答用户问题。
    用户问题: "${query}"
    统计数据: 条数=${stats.count}, 借方=${stats.totalDebit}, 贷方=${stats.totalCredit}。
    【制度上下文】:
    ${ragContext}
    
    请简练回答，并引用制度（如有）。
  `;

  return await callAI(prompt, "你是一个专业的财务机器人，回答需有理有据。", false);
};

// New: Direct Knowledge Query (No Stats) for Playground
export const queryKnowledgeBase = async (query: string) => {
    // 1. Retrieval
    const results = await searchKnowledgeBase(query, 4);
    
    // 2. Generate Answer
    const context = results.map(r => `[出处: ${r.chunk.sourceTitle}] ${r.chunk.content}`).join("\n\n");
    const prompt = `
        用户问题: "${query}"
        
        【参考资料】:
        ${context}
        
        请仅根据上述参考资料回答用户问题。如果资料中没有提到，请直接说“知识库中未找到相关信息”。
        回答要求：条理清晰，引用出处。
    `;

    const answer = await callAI(prompt, "你是一个基于企业内部知识库的问答助手。", false);

    return {
        answer,
        sources: results.map(r => ({ ...r.chunk, score: r.score }))
    };
};

// Proactive Compliance Check
export const checkLedgerCompliance = async (rows: LedgerRow[]): Promise<ComplianceResult[]> => {
    const sampleRows = rows.slice(0, 10); 
    if (sampleRows.length === 0) return [];
    const results: ComplianceResult[] = [];

    for (const row of sampleRows) {
        if (!row.subjectCode.startsWith('6') && !row.subjectCode.startsWith('54') && !row.subjectCode.startsWith('1')) continue;

        const query = `${row.departmentName} ${row.subjectName} 报销标准 限制`;
        const searchRes = await searchKnowledgeBase(query, 1);
        
        if (searchRes.length === 0) continue;
        const policyChunk = searchRes[0].chunk;
        
        const verifyPrompt = `
           判断合规性。
           记录: { 科目: "${row.subjectName}", 金额: ${row.debitAmount}, 摘要: "${row.summary}" }
           制度: "${policyChunk.content}"
           
           若疑似违规（超标/科目错/摘要模糊），返回 JSON: { "violation": true, "reason": "...", "severity": "high"|"medium" }
           否则返回 { "violation": false }
        `;

        try {
            const resStr = await callAI(verifyPrompt, "你是一个合规审计员，只返回JSON。", true);
            const res = JSON.parse(cleanJsonString(resStr));
            
            if (res.violation) {
                results.push({
                    rowId: row.id || 'unknown',
                    voucherNo: row.voucherNo,
                    summary: row.summary,
                    issue: res.reason,
                    policySource: policyChunk.sourceTitle,
                    severity: res.severity
                });
            }
        } catch (e) {
            console.warn("Compliance check error", e);
        }
    }
    return results;
};

// ... keep existing analysis functions ...
export const analyzeReconciliation = async (plans: any[], ledger: any[], mismatches: any[]): Promise<AnalysisResult> => {
    return { summary: "Analysis placeholder", risks: [], recommendations: [], kpiIndicators: [] };
};

export const analyzeInterCompanyRecon = async (entityName: string, counterpartyName: string, breakdown: any[]): Promise<AnalysisResult> => {
    const prompt = `分析关联交易差异: ${JSON.stringify(breakdown.slice(0,5))}`;
    try {
        const res = await callAI(prompt, undefined, false);
        return { summary: cleanJsonString(res).includes('{') ? JSON.parse(cleanJsonString(res)).summary : res, risks: [], recommendations: [], kpiIndicators: [] };
    } catch { return { summary: "Error", risks: [], recommendations: [], kpiIndicators: [] }}
};

export const smartVoucherMatch = async (myVouchers: any[], theirVouchers: any[]) => {
    const prompt = `Match vouchers: ${myVouchers.length} vs ${theirVouchers.length}`;
    try {
        const content = await callAI(prompt, undefined, true);
        return JSON.parse(cleanJsonString(content));
    } catch { return { matchedPairs: [], unmatchedMySide: [], unmatchedTheirSide: [], analysis: "Failed" }; }
};

export const detectFinancialAnomalies = async (entityName: string, trendData: any[]) => {
    const prompt = `Analyze anomalies: ${JSON.stringify(trendData)}`;
    try {
        const content = await callAI(prompt, "Return JSON with anomalies array.", true);
        return JSON.parse(cleanJsonString(content));
    } catch { return { anomalies: [], summary: "Failed" }; }
};

export const extractContractData = async (base64Content: string, mimeType: string) => {
    return {
        contractNo: 'DS-OCR-Needed', tenantName: 'Need Text Extraction', isRelated: false, type: 'Lease',
        startDate: '2025-01-01', endDate: '2025-12-31', amount: 0, paymentCycle: '季度'
    };
};
