import { AnalysisResult, SystemConfig, KnowledgeChunk, LedgerRow, ComplianceResult, AIQueryCache } from '../types';
import { db } from '../db';
import { GoogleGenAI, Type } from "@google/genai";

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
    let metaData = { summary: "", rules: [] as string[], entities: [] as string[], suggestedQuestions: [] as string[] };
    
    try {
        // UPDATED PROMPT FOR CHINESE OUTPUT
        const summaryPrompt = `
            Analyze this financial/business document. 
            Context: The company deals with Real Estate Assets (Houses/Buildings) and Leasing.
            
            IMPORTANT: Output must be in **Simplified Chinese (简体中文)**.
            
            1. Provide a concise summary (max 200 words).
            2. Extract list of "Key Entities" (Departments, Projects, Expense Types).
            3. Extract "Key Financial Rules" (e.g., "Meal allowance is 60 RMB", "Approval required > 5k").
            4. Generate 3 specific questions that a user might ask about this document (in Chinese).
            
            Output JSON: { "summary": string, "entities": string[], "rules": string[], "suggestedQuestions": string[] }
        `;
        const contextForSummary = content.substring(0, 30000); 
        const summaryRes = await callAI(summaryPrompt + `\n\n${contextForSummary}`, "You are a senior financial auditor.", true, MODEL_FAST);
        metaData = JSON.parse(cleanJsonString(summaryRes));
    } catch (e) {
        console.warn("MetaData extraction failed, using defaults.", e);
        metaData.summary = "文档解析成功，但摘要生成失败。";
        metaData.suggestedQuestions = [`${title} 的主要内容是什么？`, `${title} 中有哪些关键金额限制？`, "查看文档摘要"];
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
    
    // Invalidate Memory Index Cache to force rebuild on next search
    IndexManager.invalidate();

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

// ==================================================================================
// 5. HIGH-PERFORMANCE HYBRID SEARCH ENGINE (Worker + Flattened Memory)
// ==================================================================================

// The worker script is now "Stateful". It loads data once and keeps it in memory.
// It uses Float32Array for embeddings to maximize CPU cache locality.
const vectorWorkerScript = `
  let flatEmbeddings = null; // Float32Array [e1_0, e1_1, ... e1_767, e2_0...]
  let contentList = null;    // Array of strings (for keyword search)
  let ids = null;            // Array of Chunk IDs
  let dim = 768;             // Embedding dimension

  self.onmessage = function(e) {
    const { type, payload } = e.data;

    // --- Initialization Phase ---
    if (type === 'init') {
      try {
          flatEmbeddings = new Float32Array(payload.embeddings);
          contentList = payload.contents;
          ids = payload.ids;
          // console.log('Vector Index Built in Worker:', ids.length, 'vectors');
          self.postMessage({ type: 'init_done', success: true });
      } catch(err) {
          self.postMessage({ type: 'init_done', success: false, error: err.message });
      }
      return;
    }

    // --- Search Phase ---
    if (type === 'search') {
        const { queryVec, queryText, topK } = payload;
        
        if (!flatEmbeddings || !contentList || ids.length === 0) {
            self.postMessage({ type: 'search_result', results: [] });
            return;
        }

        const count = ids.length;
        const results = [];
        
        // 1. Prepare Keywords (Simple Tokenization)
        const keywords = queryText.toLowerCase().split(/[\\s,;.?!]+/).filter(k => k.length > 1);
        
        // 2. Pre-calculate Query Norm (Loop Invariant)
        let normA = 0.0;
        for(let k=0; k<dim; k++) normA += queryVec[k] * queryVec[k];
        normA = Math.sqrt(normA);

        // 3. Main Search Loop (Tight Loop for Performance)
        for (let i = 0; i < count; i++) {
            // A. Vector Score (Cosine Similarity)
            let dot = 0.0;
            let normB = 0.0;
            
            const offset = i * dim;
            
            // Unrolled loop or just standard loop. V8 optimizes this well for TypedArrays.
            for (let j = 0; j < dim; j++) {
                const v = flatEmbeddings[offset + j];
                dot += v * queryVec[j];
                normB += v * v;
            }
            
            // Avoid division by zero
            const vecScore = (normA && normB) ? (dot / (normA * Math.sqrt(normB))) : 0;

            // B. Keyword Score (Lexical)
            let kwScore = 0;
            if (keywords.length > 0) {
                const content = contentList[i].toLowerCase();
                let matches = 0;
                for (let k = 0; k < keywords.length; k++) {
                    if (content.includes(keywords[k])) matches++;
                }
                kwScore = Math.min(matches / keywords.length, 1.0); // Normalize to 0-1
            }

            // C. Hybrid Re-ranking Formula
            // 70% Semantic, 30% Exact Match
            const finalScore = (vecScore * 0.7) + (kwScore * 0.3);

            if (finalScore > 0.35) {
                results.push({ index: i, score: finalScore });
            }
        }

        // 4. Sort and Slice
        results.sort((a, b) => b.score - a.score);
        const topResults = results.slice(0, topK).map(r => ({ 
            id: ids[r.index], 
            score: r.score 
        }));
        
        self.postMessage({ type: 'search_result', results: topResults });
    }
  };
`;

// --- Singleton Manager for Vector Index ---
class IndexManager {
    private static worker: Worker | null = null;
    private static isReady: boolean = false;
    private static initializationPromise: Promise<void> | null = null;
    private static lastDocCount: number = -1;

    static invalidate() {
        this.isReady = false;
        this.lastDocCount = -1; // Force reload on next search
    }

    static async getWorker(): Promise<Worker> {
        // Check if data changed
        const currentCount = await db.chunks.count();
        
        // Initialize if first time or data changed
        if (!this.worker || !this.isReady || currentCount !== this.lastDocCount) {
            if (this.worker) this.worker.terminate(); // Kill old worker to free memory
            await this.initWorker(currentCount);
        }
        return this.worker!;
    }

    private static async initWorker(count: number) {
        // Prevent concurrent initializations
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = (async () => {
            console.time("IndexBuild");
            
            // 1. Load All Chunks (This is the heaviest I/O operation)
            const allChunks = await db.chunks.toArray();
            
            // 2. Prepare Flattened Float32Array
            const DIM = 768;
            const totalSize = allChunks.length * DIM;
            const flatEmbeddings = new Float32Array(totalSize);
            const contents: string[] = [];
            const ids: string[] = [];

            for (let i = 0; i < allChunks.length; i++) {
                const chunk = allChunks[i];
                ids.push(chunk.id);
                contents.push(chunk.content); // For keyword match in worker
                
                // Copy vector to flat array
                if (chunk.embedding && chunk.embedding.length === DIM) {
                    flatEmbeddings.set(chunk.embedding, i * DIM);
                }
            }

            // 3. Create Worker
            const blob = new Blob([vectorWorkerScript], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));

            // 4. Send Data (Transferable Object for Arrays to avoid copy overhead if possible)
            // Note: Float32Array buffer is transferable.
            await new Promise<void>((resolve, reject) => {
                worker.onmessage = (e) => {
                    if (e.data.type === 'init_done') {
                        if (e.data.success) resolve();
                        else reject(new Error(e.data.error));
                    }
                };
                worker.postMessage({ 
                    type: 'init', 
                    payload: { 
                        embeddings: flatEmbeddings.buffer, 
                        contents, 
                        ids 
                    } 
                }, [flatEmbeddings.buffer]); // Transfer ownership
            });

            this.worker = worker;
            this.isReady = true;
            this.lastDocCount = count;
            console.timeEnd("IndexBuild");
            
        })();

        try {
            await this.initializationPromise;
        } finally {
            this.initializationPromise = null;
        }
    }
}

export const searchKnowledgeBase = async (query: string, topK: number = 6): Promise<{ chunk: KnowledgeChunk, score: number }[]> => {
    try {
        const worker = await IndexManager.getWorker();

        // 1. Embed Query
        const ai = getAiClient();
        const queryEmbRes = await ai.models.embedContent({
            model: MODEL_EMBEDDING,
            contents: { parts: [{ text: query }] },
            config: { taskType: "RETRIEVAL_QUERY" }
        });
        const queryVec = queryEmbRes.embeddings?.[0]?.values || (queryEmbRes as any).embedding?.values;

        if (!queryVec) return [];

        // 2. Perform Hybrid Search in Worker
        const searchResults: { id: string, score: number }[] = await new Promise((resolve) => {
            const handler = (e: MessageEvent) => {
                if (e.data.type === 'search_result') {
                    worker.removeEventListener('message', handler);
                    resolve(e.data.results);
                }
            };
            worker.addEventListener('message', handler);
            worker.postMessage({ 
                type: 'search', 
                payload: { queryVec, queryText: query, topK } 
            });
        });

        // 3. Hydrate Results (Fetch full objects only for top K)
        if (searchResults.length === 0) return [];
        
        const topIds = searchResults.map(r => r.id);
        const chunks = await db.chunks.bulkGet(topIds);
        
        return chunks
            .filter(c => c !== undefined)
            .map((c, i) => ({
                chunk: c!,
                score: searchResults[i].score
            }));

    } catch (e) {
        console.error("Search failed", e);
        return [];
    }
};

export const getDocumentChunks = async (documentId: string): Promise<KnowledgeChunk[]> => {
    return await db.chunks.where('documentId').equals(documentId).toArray();
};

export const queryKnowledgeBase = async (query: string): Promise<{ answer: string, sources: any[] }> => {
    const searchResults = await searchKnowledgeBase(query, 4); 
    if (searchResults.length === 0) {
        return { answer: "未在知识库中找到相关信息。", sources: [] };
    }

    const context = searchResults.map((r, index) => 
        `[[CITATION_ID:${index + 1}]]\nSOURCE: ${r.chunk.sourceTitle}\nCONTENT: ${r.chunk.content}`
    ).join("\n\n");

    const systemInstruction = `You are a financial assistant. Answer based on context in Simplified Chinese. Cite sources using [1], [2].`;
    const prompt = `Context:\n${context}\n\nQuestion: ${query}`;
    
    const answer = await callAI(prompt, systemInstruction, false, MODEL_FAST);
    
    return {
        answer,
        sources: searchResults.map(r => ({ ...r.chunk, score: r.score }))
    };
};

// --- Streaming Support with CACHING ---
export async function* queryKnowledgeBaseStream(query: string) {
    // 1. Check Cache
    try {
        const cached = await db.queryCache.where({ queryText: query.trim() }).first();
        if (cached && (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000)) { // 24h Cache
            yield { type: 'sources', sources: cached.sources };
            yield { type: 'text', content: cached.answer };
            console.log("Hit Local Cache");
            return;
        }
    } catch (e) {
        console.warn("Cache read failed", e);
    }

    // 2. Perform Search (Reduced to 4 to minimize hallucination)
    const searchResults = await searchKnowledgeBase(query, 4); 
    
    if (searchResults.length === 0) {
        yield { type: 'text', content: "未在知识库中找到相关信息。" };
        return;
    }

    const sources = searchResults.map(r => ({ ...r.chunk, score: r.score }));
    yield { type: 'sources', sources: sources };

    // Explicitly Label Context for AI
    const context = searchResults.map((r, index) => 
        `[[CITATION_ID:${index + 1}]]\nSOURCE: ${r.chunk.sourceTitle}\nCONTENT: ${r.chunk.content}`
    ).join("\n\n");

    // UPDATED SYSTEM INSTRUCTION FOR STRICT CITATIONS
    const systemInstruction = `
        You are a highly precise Financial Compliance Assistant.
        
        CRITICAL RULES:
        1. Answer ONLY based on the provided Context.
        2. ALWAYS Answer in **Simplified Chinese (简体中文)**.
        3. CITATIONS: When using information from a block labeled [[CITATION_ID:x]], you MUST append [x] to the end of the sentence.
        4. ACCURACY: Do not invent citation numbers. If you use information from Context 1, label it [1]. If from Context 2, label it [2].
        5. FORMAT: Use standard brackets [1]. Do not use markdown links like [1](...).
        
        Context Provided:
        ${context}
    `;
    
    const prompt = `Question: ${query}`;
    
    const ai = getAiClient();
    
    let fullAnswer = "";

    try {
        const stream = await ai.models.generateContentStream({
            model: MODEL_FAST,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.1 // Lower temp for more deterministic behavior
            }
        });

        for await (const chunk of stream) {
            const text = chunk.text;
            if (text) {
                fullAnswer += text;
                yield { type: 'text', content: text };
            }
        }

        // 3. Save to Cache after successful streaming
        if (fullAnswer.length > 10) {
            await db.queryCache.add({
                queryHash: btoa(encodeURIComponent(query.trim())), // Simple hash
                queryText: query.trim(),
                answer: fullAnswer,
                sources: sources,
                timestamp: Date.now()
            });
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

    const ai = getAiClient();
    try {
        const response = await ai.models.generateContent({
             model: MODEL_FAST,
             contents: prompt,
             config: {
                 systemInstruction: systemPrompt,
                 // Enable Thinking for complex reasoning (limited to 2k tokens to start fast)
                 thinkingConfig: { thinkingBudget: 1024 },
                 temperature: 0.2
             }
        });
        return response.text || "AI 无法生成回答。";
    } catch(e) {
        // Fallback if Thinking is not supported or errors
        return await callAI(prompt, systemPrompt, false, MODEL_FAST);
    }
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
        Only output found issues. If none, return empty array.
    `;

    // Use Schema for 100% Reliable JSON
    const ai = getAiClient();
    try {
        const response = await ai.models.generateContent({
            model: MODEL_FAST,
            contents: auditPrompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            rowId: { type: Type.STRING },
                            voucherNo: { type: Type.STRING },
                            summary: { type: Type.STRING },
                            issue: { type: Type.STRING },
                            severity: { type: Type.STRING, enum: ["high", "medium", "low"] },
                            policySource: { type: Type.STRING }
                        },
                        required: ["rowId", "voucherNo", "issue"]
                    }
                }
            }
        });
        const jsonStr = response.text?.trim() || "[]";
        return JSON.parse(jsonStr);
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