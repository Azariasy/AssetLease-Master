
import { AnalysisResult, SystemConfig, KnowledgeChunk, LedgerRow, ComplianceResult } from '../types';
import { db } from '../db';
import { GoogleGenAI } from "@google/genai";

// ==========================================
// 1. API Configuration & Clients
// ==========================================

// Gemini 3.0 Series
const MODEL_FAST = "gemini-3-flash-preview"; 
const MODEL_LARGE = "gemini-3-pro-preview"; 

const MODEL_REASONING = "gemini-3-flash-preview"; 
const MODEL_EMBEDDING = "text-embedding-004";

const cleanJsonString = (str: string) => {
    return str.replace(/```json\n?|```/g, '').trim();
};

const getAiClient = () => {
    if (!process.env.API_KEY) {
        throw new Error("API Key is missing. Please check your environment configuration.");
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// Unified AI Call Wrapper with Retry
const callAI = async (prompt: string, systemInstruction?: string, jsonMode: boolean = false, model: string = MODEL_FAST) => {
    const ai = getAiClient();
    let retries = 2;
    while (retries > 0) {
        try {
            const response = await ai.models.generateContent({
                model: model,
                contents: prompt,
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: jsonMode ? "application/json" : "text/plain",
                    temperature: 0.2 
                }
            });
            return response.text || '';
        } catch (e: any) {
            // Check for specific API errors
            if (e.message?.includes("404") || e.message?.includes("not found")) {
                throw new Error(`模型不可用 (${model})。请检查 API Key 权限或模型名称配置。`);
            }
            if (e.message?.includes("token count exceeds") || e.message?.includes("400")) {
                // If we were using FAST, try LARGE once
                if (model === MODEL_FAST) {
                    console.warn("Token limit hit on FAST model, retrying with LARGE model...");
                    return callAI(prompt, systemInstruction, jsonMode, MODEL_LARGE);
                }
                throw new Error("文档过大，超过模型处理上限。请拆分文件后重试。");
            }
            console.warn(`AI Call failed (${retries} left):`, e.message);
            retries--;
            if (retries === 0) throw e;
            await new Promise(r => setTimeout(r, 2000)); // Backoff
        }
    }
    return '';
};

// ==========================================
// 2. Advanced Document Parsing (Browser Optimized)
// ==========================================

export const parseDocumentWithAI = async (
    file: File, 
    base64Data: string, 
    mimeType: string, 
    onProgress?: (msg: string) => void
): Promise<string> => {
    if (mimeType === 'text/plain' && !base64Data.startsWith('JVBERi0') && base64Data.length > 0) {
         if (onProgress) onProgress("本地解析成功，跳过 AI OCR...");
         return base64Data;
    }

    const approximateSize = base64Data.length * 0.75;
    if (approximateSize > 20 * 1024 * 1024) {
        throw new Error("文件过大 (>20MB)，无法直接进行 AI 识别。请尝试拆分文件或上传纯文本格式。");
    }

    const ai = getAiClient();
    
    if (onProgress) onProgress("AI 正在全文阅读与结构化提取...");
    
    try {
        const response = await ai.models.generateContent({
            model: MODEL_FAST,
            contents: {
                parts: [
                    { 
                        inlineData: { 
                            mimeType: mimeType, 
                            data: base64Data 
                        } 
                    },
                    { text: `
                        You are a document conversion expert. 
                        Convert this document into clean, structured Markdown.
                        Rules:
                        1. Keep all headers (#, ##).
                        2. Convert tables into Markdown tables.
                        3. KEEP ALL NUMBERS AND DATES EXACT.
                        4. Do not summarize, output full text content.
                        5. If the document is an image, perform OCR.
                    ` }
                ]
            }
        });
        
        return response.text || '';
    } catch (fastError: any) {
        if (fastError.message?.includes("404") || fastError.message?.includes("not found")) {
            throw new Error(`模型 ${MODEL_FAST} 不可用，请更新配置。`);
        }
        if (fastError.message?.includes("413") || fastError.message?.includes("Payload Too Large")) {
             throw new Error("文件过大，浏览器端无法直接上传。请将 PDF 拆分或转为 Markdown 文本上传。");
        }
        if (fastError.message?.includes("token count exceeds") || fastError.message?.includes("limit")) {
            if (onProgress) onProgress("文档超大，切换至 Pro 模型处理...");
            try {
                const response = await ai.models.generateContent({
                    model: MODEL_LARGE,
                    contents: {
                        parts: [
                            { inlineData: { mimeType: mimeType, data: base64Data } },
                            { text: "Convert to Markdown. Maintain structure and numbers exactly." }
                        ]
                    }
                });
                return response.text || '';
            } catch (e: any) {
                throw new Error(`文档解析失败 (Pro): ${e.message}`);
            }
        }
        throw fastError;
    }
};

// ==========================================
// 3. Semantic Chunking (Recursive Strategy)
// ==========================================

const recursiveSplit = (text: string, maxLength: number = 800, overlap: number = 100): string[] => {
    if (!text) return [];
    if (text.length <= maxLength) return [text];

    const separators = ["\n\n", "\n", "。", "；", ";", ". ", " "];
    let splitChar = "";
    
    for (const sep of separators) {
        if (text.includes(sep)) {
            splitChar = sep;
            break;
        }
    }

    if (!splitChar) {
        const chunks = [];
        for (let i = 0; i < text.length; i += (maxLength - overlap)) {
            chunks.push(text.substring(i, i + maxLength));
        }
        return chunks;
    }

    const parts = text.split(splitChar);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const part of parts) {
        const nextChunk = currentChunk + (currentChunk ? splitChar : "") + part;
        if (nextChunk.length > maxLength) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = part; 
            } else {
                const subChunks = recursiveSplit(part, maxLength, overlap);
                chunks.push(...subChunks);
                currentChunk = ""; 
            }
        } else {
            currentChunk = nextChunk;
        }
    }
    if (currentChunk) chunks.push(currentChunk);
    
    return chunks;
};

// ==========================================
// 4. Ingestion Pipeline
// ==========================================

export const ingestDocument = async (docId: string, title: string, content: string, progressCallback?: (stage: string) => void) => {
    if(progressCallback) progressCallback("正在进行语义切片...");
    
    // 1. Semantic Chunking
    const textSegments = recursiveSplit(content, 1000, 150).filter(s => s.trim().length > 0);
    
    if (textSegments.length === 0) throw new Error("文档内容为空");

    // 2. Macro Understanding
    if(progressCallback) progressCallback("AI 正在提取关键财务规则...");
    let metaData = { summary: "", rules: [] as string[], entities: [] as string[] };
    
    try {
        const summaryPrompt = `
            Analyze this financial/business document. 
            Context: The company deals with Real Estate Assets (Houses/Buildings) and Leasing.
            1. Provide a concise summary (max 200 words).
            2. Extract list of "Key Entities" (Departments, Projects, Expense Types).
            3. Extract "Key Financial Rules" (e.g., "Meal allowance is 60 RMB", "Approval required > 5k").
            
            Output JSON: { "summary": string, "entities": string[], "rules": string[] }
        `;
        const contextForSummary = content.substring(0, 30000); 
        const summaryRes = await callAI(summaryPrompt + `\n\n${contextForSummary}`, "You are a senior financial auditor.", true, MODEL_FAST);
        metaData = JSON.parse(cleanJsonString(summaryRes));
    } catch (e) {
        console.warn("MetaData extraction failed, using defaults.", e);
        metaData.summary = content.substring(0, 200) + "...";
    }

    // 3. Batch Embeddings
    if(progressCallback) progressCallback(`正在生成向量索引 (${textSegments.length} 切片)...`);
    
    const embeddings: number[][] = [];
    const BATCH_SIZE = 5; 
    
    for (let i = 0; i < textSegments.length; i += BATCH_SIZE) {
        const batch = textSegments.slice(i, i + BATCH_SIZE);
        if(progressCallback) progressCallback(`云端向量化: ${Math.min(i + BATCH_SIZE, textSegments.length)}/${textSegments.length}`);
        
        try {
            const batchResult = await getEmbeddings(batch);
            embeddings.push(...batchResult);
        } catch (e) {
            console.error(`Batch embedding failed at index ${i}`, e);
            batch.forEach(() => embeddings.push(new Array(768).fill(0))); 
        }
    }

    // 4. Store Chunks
    if(progressCallback) progressCallback("正在存入本地知识图谱...");
    
    const chunks: KnowledgeChunk[] = textSegments.map((seg, i) => ({
        id: `${docId}-c${i}`,
        documentId: docId,
        content: seg,
        embedding: embeddings[i] || [], 
        sourceTitle: title,
        tags: metaData.entities || []
    }));

    await db.chunks.bulkAdd(chunks);
    
    return metaData;
};

export const getEmbeddings = async (texts: string[], onProgress?: (processed: number, total: number) => void): Promise<number[][]> => {
    if (!texts || texts.length === 0) return [];
    const ai = getAiClient();

    const promises = texts.map(async (t) => {
        if (!t || !t.trim()) return [];
        try {
            const res = await ai.models.embedContent({
                model: MODEL_EMBEDDING,
                contents: { parts: [{ text: t }] },
                config: {
                    taskType: "RETRIEVAL_DOCUMENT"
                }
            });
            return res.embeddings?.[0]?.values || (res as any).embedding?.values || [];
        } catch (innerE) {
            console.error("Single embedding failed", innerE);
            return [];
        }
    });

    return Promise.all(promises);
};

// ==========================================
// 5. Hybrid Search & RAG (The "Retrieval" Phase)
// ==========================================

// --- Web Worker for Hybrid Search (Vector + Keyword) ---
// This upgrades the search from simple Cosine to Hybrid for better accuracy with specific terms.
const vectorWorkerScript = `
  self.onmessage = function(e) {
    const { queryVec, queryText, chunks, topK } = e.data;
    if (!chunks || chunks.length === 0) {
      self.postMessage([]);
      return;
    }
    
    // 1. Vector Similarity (Semantic)
    function cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dot = 0.0, normA = 0.0, normB = 0.0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
    }

    // 2. Keyword Match (Lexical) - Simple scoring
    const keywords = queryText.toLowerCase().split(/\\s+|[,.?;]/).filter(k => k.length > 1);
    function getKeywordScore(content) {
        if (!content) return 0;
        const lowerContent = content.toLowerCase();
        let matches = 0;
        for (const k of keywords) {
            if (lowerContent.includes(k)) matches++;
        }
        // Normalize: max 5 keywords match = 1.0
        return Math.min(matches / 5, 1.0); 
    }

    const results = chunks
        .map(chunk => {
            const vecScore = chunk.embedding ? cosineSimilarity(queryVec, chunk.embedding) : 0;
            const kwScore = getKeywordScore(chunk.content);
            
            // Hybrid Score: 70% Semantic, 30% Keyword
            // This ensures exact matches (like "5000元") get a boost over vague semantic matches
            const finalScore = (vecScore * 0.7) + (kwScore * 0.3);
            
            return { chunk, score: finalScore };
        })
        .filter(r => r.score > 0.4) // Slightly lower threshold for hybrid
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    self.postMessage(results);
  };
`;

const createVectorWorker = () => {
  const blob = new Blob([vectorWorkerScript], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

export const searchKnowledgeBase = async (query: string, topK: number = 6): Promise<{ chunk: KnowledgeChunk, score: number }[]> => {
    try {
        const allChunks = await db.chunks.toArray();
        if (allChunks.length === 0) return [];

        const ai = getAiClient();
        const queryEmbRes = await ai.models.embedContent({
            model: MODEL_EMBEDDING,
            contents: { parts: [{ text: query }] },
            config: {
                taskType: "RETRIEVAL_QUERY"
            }
        });
        
        const queryVec = queryEmbRes.embeddings?.[0]?.values || (queryEmbRes as any).embedding?.values;

        if (!queryVec) return [];

        return new Promise((resolve) => {
            const worker = createVectorWorker();
            worker.onmessage = (e) => {
                resolve(e.data);
                worker.terminate();
            };
            worker.onerror = (err) => {
                console.error("Vector worker error", err);
                worker.terminate();
                resolve([]);
            };
            // Send query text for keyword matching
            worker.postMessage({ queryVec, queryText: query, chunks: allChunks, topK });
        });
    } catch (e) {
        console.error("Search failed", e);
        return [];
    }
};

export const getDocumentChunks = async (documentId: string): Promise<KnowledgeChunk[]> => {
    return await db.chunks.where('documentId').equals(documentId).toArray();
};

export const queryKnowledgeBase = async (query: string): Promise<{ answer: string, sources: any[] }> => {
    const searchResults = await searchKnowledgeBase(query, 5); 
    if (searchResults.length === 0) {
        return { answer: "未在知识库中找到相关信息。", sources: [] };
    }

    const context = searchResults.map((r, index) => 
        `[${index + 1}] (Source: ${r.chunk.sourceTitle})\n${r.chunk.content}`
    ).join("\n\n");

    const systemInstruction = `You are a financial assistant. Answer based on context. Cite sources using [1], [2].`;
    const prompt = `Context:\n${context}\n\nQuestion: ${query}`;
    
    const answer = await callAI(prompt, systemInstruction, false, MODEL_FAST);
    
    return {
        answer,
        sources: searchResults.map(r => ({ ...r.chunk, score: r.score }))
    };
};

// --- Streaming Support ---
export async function* queryKnowledgeBaseStream(query: string) {
    const searchResults = await searchKnowledgeBase(query, 6); // Fetch slightly more for context
    
    if (searchResults.length === 0) {
        yield { type: 'text', content: "未在知识库中找到相关信息。" };
        return;
    }

    yield { type: 'sources', sources: searchResults.map(r => ({ ...r.chunk, score: r.score })) };

    const context = searchResults.map((r, index) => 
        `[${index + 1}] (Source: ${r.chunk.sourceTitle})\n${r.chunk.content}`
    ).join("\n\n");

    const systemInstruction = `
        You are a highly precise Financial Compliance Assistant.
        
        STRICT CITATION RULES:
        1. Answer the user's question based ONLY on the provided Context.
        2. Every key statement MUST have a citation in the format [x] at the end of the sentence.
        3. Do not make up information. If the answer is not in the context, say you don't know.
        4. Refer to the sources by their number [1], [2], etc.
        
        Example Answer:
        The travel allowance for meals is 60 RMB per day [1]. However, in Beijing, this limit is increased to 80 RMB [2].
    `;
    
    const prompt = `Context:\n${context}\n\nQuestion: ${query}`;
    
    const ai = getAiClient();
    
    try {
        const stream = await ai.models.generateContentStream({
            model: MODEL_FAST,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2
            }
        });

        for await (const chunk of stream) {
            const text = chunk.text;
            if (text) {
                yield { type: 'text', content: text };
            }
        }
    } catch (e: any) {
        console.error("Stream error", e);
        yield { type: 'text', content: "\n[AI 连接中断]" };
    }
}

// ... (Rest of existing integrations remain unchanged) ...
export const parseNaturalLanguageQuery = async (query: string, validPeriods: string[], config: SystemConfig) => {
    const prompt = `
        用户查询: "${query}"
        已知期间: ${JSON.stringify(validPeriods.slice(0, 5))}...
        请提取: { "period": "YYYY-MM", "keyword": "...", "category": "income|cost|asset", "subjectCode": "..." }
        只返回JSON。
    `;
    try {
        const res = await callAI(prompt, "JSON Parser", true, MODEL_FAST);
        return JSON.parse(cleanJsonString(res));
    } catch {
        return { period: '', keyword: query, category: '' };
    }
};

export const generateNlqResponse = async (query: string, stats: any, context?: any) => {
    const prompt = `User Query: ${query}\nStats: ${JSON.stringify(stats)}\nContext: ${JSON.stringify(context)}`;
    return await callAI(prompt, "Brief answer based on stats", false, MODEL_FAST);
};

export const generateChatResponse = async (history: any[], query: string, stats?: any) => {
    const searchRes = await searchKnowledgeBase(query, 4);
    const knowledgeContext = searchRes.map(r => `[Policy: ${r.chunk.sourceTitle}]: ${r.chunk.content}`).join("\n\n");
    const dataContext = stats ? `[Current Data Stats]: ${JSON.stringify(stats)}` : "";

    const systemPrompt = `
        You are an expert Financial Controller assistant.
        Use the provided [Knowledge Context] (Policies) and [Data Stats] (Actual Numbers) to answer.
    `;

    const prompt = `
        ${knowledgeContext}
        ${dataContext}
        
        User History: ${JSON.stringify(history.slice(-2))}
        User Question: ${query}
    `;

    return await callAI(prompt, systemPrompt, false, MODEL_REASONING);
};

export const checkLedgerCompliance = async (rows: LedgerRow[]): Promise<ComplianceResult[]> => { 
    if (rows.length === 0) return [];

    const summaries = rows.map(r => r.summary).join(" ");
    const topicsPrompt = `Extract 3 main expense topics from these summaries: "${summaries.substring(0, 1000)}..." (e.g. Travel, Meals). Return space separated keywords.`;
    const keywords = await callAI(topicsPrompt, undefined, false, MODEL_FAST);
    
    const policies = await searchKnowledgeBase(keywords, 4);
    const policyContext = policies.map(p => `[Policy: ${p.chunk.sourceTitle}]: ${p.chunk.content}`).join("\n\n");

    const auditPrompt = `
        You are a strict Internal Auditor.
        
        [RELEVANT POLICIES]:
        ${policyContext || "No specific local policies found. Use general GAAP rules."}

        [TRANSACTIONS TO AUDIT]:
        ${JSON.stringify(rows.map(r => ({
            id: r.id,
            voucher: r.voucherNo,
            summary: r.summary,
            amount: r.debitAmount > 0 ? r.debitAmount : r.creditAmount,
            account: r.subjectName
        })))}

        Task: Identify potentially non-compliant transactions based on the policies above.
        Output JSON Array: [{ "rowId": "...", "voucherNo": "...", "summary": "...", "issue": "Specific violation reason referencing policy if possible", "severity": "high"|"medium", "policySource": "Policy Title or General Rule" }]
        Only output found issues. If none, return [].
    `;

    try {
        const res = await callAI(auditPrompt, "JSON Auditor", true, MODEL_LARGE); 
        const results = JSON.parse(cleanJsonString(res));
        return results;
    } catch (e) {
        console.error("Compliance Check Failed", e);
        return [];
    }
};

export const analyzeInterCompanyRecon = async (a: string, b: string, c: any[]): Promise<AnalysisResult> => { return { summary: "Analysis", risks: [], recommendations: [], kpiIndicators: [] }; };
export const smartVoucherMatch = async (a: any[], b: any[]) => { return { matchedPairs: [], unmatchedMySide: [], unmatchedTheirSide: [], analysis: "" }; };
export const detectFinancialAnomalies = async (a: string, b: any[]) => { return { anomalies: [], summary: "" }; };

export const extractContractData = async (content: string, mimeType: string, isBinary: boolean): Promise<any> => {
    const ai = getAiClient();
    const prompt = `Extract lease contract details to JSON: { contractNo, tenantName, isRelated, type, startDate, endDate, amount, paymentCycle }`;

    try {
         let resultText = "";
         if (isBinary) {
             const response = await ai.models.generateContent({
                model: MODEL_FAST,
                contents: {
                    parts: [
                        { inlineData: { mimeType: mimeType, data: content } },
                        { text: prompt }
                    ]
                },
                config: { responseMimeType: "application/json" }
            });
            resultText = response.text || "{}";
         } else {
             resultText = await callAI(prompt + "\n\nContract Text:\n" + content.substring(0, 30000), "JSON Extractor", true, MODEL_FAST);
         }
         return JSON.parse(cleanJsonString(resultText));
    } catch (e) {
        console.error("Extraction failed", e);
        return {};
    }
};
