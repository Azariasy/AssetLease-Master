
import { AnalysisResult, SystemConfig, KnowledgeChunk, LedgerRow, ComplianceResult } from '../types';
import { db } from '../db';

// DeepSeek API Configuration
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const MODEL_CHAT = "deepseek-chat";

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

// Helper: Enhanced Error Parser
const parseApiError = async (response: Response): Promise<string> => {
    let errorMsg = `HTTP Error ${response.status} ${response.statusText}`;
    try {
        const errorText = await response.text();
        if (errorText) {
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error && errorJson.error.message) {
                    errorMsg = `API Error: ${errorJson.error.message}`;
                } else if (errorJson.message) {
                    errorMsg = `API Error: ${errorJson.message}`;
                } else {
                    errorMsg = `API Error: ${errorText.substring(0, 100)}`; // Truncate if too long
                }
            } catch {
                errorMsg = `API Error: ${errorText.substring(0, 100)}`;
            }
        }
    } catch (e) {
        // failed to read text
    }
    return errorMsg;
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
            const errorMsg = await parseApiError(response);
            throw new Error(errorMsg);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || '';

    } catch (e: any) {
        console.error("DeepSeek Call Failed:", e);
        throw new Error(`AI Service Error: ${e.message}`);
    }
};

// ==========================================
// 2. Embedding Worker Implementation (Stability Upgrade: Dynamic Module)
// ==========================================

// FIX: We use a Module Worker with Dynamic Imports.
// 1. Replaced importScripts (Classic) with await import() (Module) to fix NetworkError on CDN.
// 2. Disabled browser cache to fix the "buffer undefined" error (corrupt WASM cache).
// 3. Explicitly set wasmPaths to absolute URLs to fix the "dirname" error (path resolution failure).
const EMBEDDING_WORKER_SCRIPT = `
let pipeline = null;
let env = null;
let extractor = null;

// Helper to load library dynamically
async function loadLibrary() {
    if (pipeline) return;

    try {
        // Use unminified .js from dist which is a valid ESM entry point on JSDelivr
        const module = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.js');
        pipeline = module.pipeline;
        env = module.env;

        // 1. Critical Environment Config
        // Disable local model checks to prevent file system access (fixes dirname errors)
        env.allowLocalModels = false;
        
        // Disable cache to prevent "reading 'buffer' of undefined" errors with corrupted cache
        env.useBrowserCache = false;

        // 2. Configure Backend (ONNX Runtime Web)
        env.backends.onnx.wasm.proxy = false; 
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.simd = false; 
        
        // 3. Absolute Paths for WASM
        // Explicit mapping prevents the library from trying to construct relative paths
        env.backends.onnx.wasm.wasmPaths = {
            'ort-wasm.wasm': 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm.wasm',
            'ort-wasm-simd.wasm': 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm-simd.wasm',
            'ort-wasm-threaded.wasm': 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm-threaded.wasm',
            'ort-wasm-simd-threaded.wasm': 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/ort-wasm-simd-threaded.wasm',
        };

    } catch (e) {
        throw new Error("Failed to load AI library: " + e.message);
    }
}

self.onmessage = async (e) => {
    const { id, texts, task } = e.data;

    try {
        if (task === 'init') {
             await loadLibrary();
             if (!extractor) {
                // Use a smaller quantized model for browser stability
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
             }
             self.postMessage({ id, status: 'ready' });
             return;
        }

        if (task === 'embed') {
            await loadLibrary();
            if (!extractor) {
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            }
            
            // Generate embeddings
            const output = await extractor(texts, { pooling: 'mean', normalize: true });
            const embeddings = output.tolist();
            
            // Normalize output structure
            let finalEmbeddings = [];
            if (texts.length === 1 && !Array.isArray(embeddings[0])) {
                finalEmbeddings = [embeddings];
            } else {
                finalEmbeddings = embeddings;
            }

            self.postMessage({ id, status: 'complete', output: finalEmbeddings });
        }
    } catch (err) {
        console.error("Embedding Worker Error:", err);
        self.postMessage({ 
            id, 
            status: 'error', 
            error: err.message || "AI Engine Error: Check network/firewall." 
        });
    }
};
`;

let embeddingWorker: Worker | null = null;
const pendingRequests = new Map<string, { resolve: Function, reject: Function, timer: any }>();

const getEmbeddingWorker = () => {
    if (!embeddingWorker) {
        try {
            const blob = new Blob([EMBEDDING_WORKER_SCRIPT], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            
            // FIX: Use { type: 'module' } to support dynamic imports inside the worker
            embeddingWorker = new Worker(url, { type: 'module' });
            
            embeddingWorker.onmessage = (e) => {
                const { id, status, output, error } = e.data;
                const request = pendingRequests.get(id);
                
                if (request) {
                    clearTimeout(request.timer); // Clear timeout
                    if (status === 'complete') {
                        request.resolve(output);
                    } else if (status === 'error') {
                        request.reject(new Error(error));
                    }
                    pendingRequests.delete(id);
                }
            };

            embeddingWorker.onerror = (e) => {
                console.error("Worker Global Error:", e);
                // Fail all pending requests
                pendingRequests.forEach((req, key) => {
                    clearTimeout(req.timer);
                    req.reject(new Error("AI Worker crashed. Possible WASM/Network issue."));
                    pendingRequests.delete(key);
                });
                embeddingWorker = null; // Reset to try recreation next time
            };
        } catch (e) {
            console.error("Worker creation failed:", e);
            throw new Error("无法创建 AI 计算线程，请使用最新版 Chrome/Edge 浏览器。");
        }
    }
    return embeddingWorker;
};

export const getEmbeddings = async (texts: string[], onProgress?: (processed: number, total: number) => void): Promise<number[][]> => {
    const cleanTexts = texts.map(t => t.trim()).filter(t => t.length > 0);
    if (cleanTexts.length === 0) return [];

    let worker: Worker;
    try {
        worker = getEmbeddingWorker();
    } catch (e: any) {
        throw new Error(e.message);
    }

    const allEmbeddings: number[][] = [];
    const BATCH_SIZE = 5; // Conservative batch size

    try {
        for (let i = 0; i < cleanTexts.length; i += BATCH_SIZE) {
            const batch = cleanTexts.slice(i, i + BATCH_SIZE);
            const requestId = `req-${Date.now()}-${i}`;
            
            // Create a promise with a safety timeout
            const batchPromise = new Promise<number[][]>((resolve, reject) => {
                // Increased timeout for first load (model download)
                const timeoutDuration = i === 0 ? 120000 : 60000; 
                const timer = setTimeout(() => {
                    if (pendingRequests.has(requestId)) {
                        pendingRequests.delete(requestId);
                        reject(new Error("AI计算超时。请检查网络是否能访问 jsdelivr.net，或者刷新重试。"));
                    }
                }, timeoutDuration);

                pendingRequests.set(requestId, { resolve, reject, timer });
                worker.postMessage({ id: requestId, task: 'embed', texts: batch });
            });

            const batchResult = await batchPromise;
            allEmbeddings.push(...batchResult);

            if (onProgress) {
                onProgress(Math.min(i + BATCH_SIZE, cleanTexts.length), cleanTexts.length);
            }
        }
        return allEmbeddings;
    } catch (e: any) {
        console.error("Worker Embedding Failed:", e);
        // Clean up
        if (embeddingWorker) {
            embeddingWorker.terminate();
            embeddingWorker = null;
        }
        throw new Error(`AI 引擎错误: ${e.message}`);
    }
};

// ==========================================
// 3. Vector Utilities (Client-Side)
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
        
        console.log(`Searching for: "${query}"`);
        console.log("Top 3 matches:", scored.slice(0, 3).map(s => ({ title: s.chunk.sourceTitle, score: s.score, text: s.chunk.content.substring(0, 20) })));

        return scored.slice(0, topK);
    } catch (e: any) {
        console.error("Vector search failed:", e);
        return [];
    }
};

// ==========================================
// 4. Knowledge Ingestion Pipeline
// ==========================================

const slidingWindowSplit = (text: string, chunkSize: number = 500, overlap: number = 50): string[] => {
    if (text.length <= chunkSize) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = start + chunkSize;
        let chunk = text.slice(start, end);
        if (end < text.length) {
            const lastPunctuation = Math.max(
                chunk.lastIndexOf('。'), 
                chunk.lastIndexOf('；'), 
                chunk.lastIndexOf('！'), 
                chunk.lastIndexOf('\n')
            );
            if (lastPunctuation !== -1 && lastPunctuation > chunkSize * 0.7) {
                end = start + lastPunctuation + 1;
                chunk = text.slice(start, end);
            }
        }
        chunks.push(chunk.trim());
        start = end - overlap; 
    }
    return chunks;
};

const chunkText = (text: string, title: string): string[] => {
    let cleanText = text.replace(/[ \t]+/g, ' ').trim(); 
    cleanText = cleanText.replace(/\r\n/g, '\n');

    let segments = cleanText.split(/(^#+ .+$)/gm).filter(t => t.trim().length > 30);
    if (segments.length <= 1) {
        segments = cleanText.split(/\n\s*\n/).filter(t => t.trim().length > 30);
    }
    // Reduced chunk trigger size to 600
    if (segments.length <= 1 && cleanText.length > 600) {
        return slidingWindowSplit(cleanText, 500, 50);
    }

    const MAX_CHUNK_LENGTH = 800; // Reduced from 1000
    const finalChunks: string[] = [];
    let currentBuffer = "";

    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        if (trimmed.length > MAX_CHUNK_LENGTH) {
            if (currentBuffer) {
                finalChunks.push(currentBuffer);
                currentBuffer = "";
            }
            const subChunks = slidingWindowSplit(trimmed, 500, 50);
            finalChunks.push(...subChunks);
        } else if ((currentBuffer.length + trimmed.length) > MAX_CHUNK_LENGTH) {
            finalChunks.push(currentBuffer);
            currentBuffer = trimmed;
        } else {
            currentBuffer = currentBuffer ? currentBuffer + "\n\n" + trimmed : trimmed;
        }
    }
    if (currentBuffer) finalChunks.push(currentBuffer);
    return finalChunks.filter(c => c.length > 10);
};

export const ingestDocument = async (docId: string, title: string, content: string, progressCallback?: (stage: string) => void) => {
    if(progressCallback) progressCallback("正在预处理文本...");
    
    if (!content || content.length < 10) {
        throw new Error("提取的文本过短，系统判断为无效文档。");
    }

    if(progressCallback) progressCallback("正在进行智能分片 (Chunking)...");
    const textSegments = chunkText(content, title);
    
    if (textSegments.length === 0) {
        throw new Error("分片失败，未能生成有效的数据切片。");
    }
    
    if(progressCallback) progressCallback("正在提取元数据...");
    const summaryPrompt = `
      请提取本文档的核心实体（部门、费用类型、业务名词）和摘要。
      文档内容片段：${content.substring(0, 2000)}...
      请务必只返回标准的 JSON 格式。
      格式: { "summary": "精炼摘要...", "entities": ["研发部", "差旅费", ...] }
    `;
    
    let summaryData = { summary: "解析失败", entities: [] };
    try {
        const summaryResStr = await callAI(summaryPrompt, "You are a JSON generator.", true);
        summaryData = JSON.parse(cleanJsonString(summaryResStr));
    } catch (e: any) {
        console.warn("Summary generation warning:", e);
        summaryData = { summary: content.substring(0, 200) + "...", entities: [] };
    }

    if(progressCallback) progressCallback(`准备生成向量索引 (${textSegments.length} 个切片)...`);
    let embeddings: number[][] = [];
    try {
        // Embeddings with progress
        embeddings = await getEmbeddings(textSegments, (processed, total) => {
            if(progressCallback) progressCallback(`后台 AI 计算中 (首次需下载模型): ${processed} / ${total}`);
        });
        
        if (embeddings.length !== textSegments.length) {
             throw new Error("向量生成数量不匹配，请重试。");
        }
    } catch (e: any) {
        console.error("Embedding generation failed", e);
        throw new Error(`向量生成失败: ${e.message}。如果网络正常，请检查是否被公司防火墙拦截了 WASM 文件。`);
    }

    // --- BATCH SAVE LOGIC START ---
    const SAVE_BATCH_SIZE = 100;
    const totalChunks = textSegments.length;
    
    if(progressCallback) progressCallback(`准备入库 ${totalChunks} 个索引数据...`);

    try {
        for (let i = 0; i < totalChunks; i += SAVE_BATCH_SIZE) {
            const end = Math.min(i + SAVE_BATCH_SIZE, totalChunks);
            
            // Create batch
            const chunkBatch: KnowledgeChunk[] = [];
            for(let j = i; j < end; j++) {
                chunkBatch.push({
                    id: `${docId}-c${j}`,
                    documentId: docId,
                    content: textSegments[j],
                    embedding: embeddings[j],
                    sourceTitle: title,
                    tags: summaryData.entities || []
                });
            }

            // Write batch
            await db.chunks.bulkAdd(chunkBatch);
            
            if(progressCallback) {
                const pct = Math.floor((end / totalChunks) * 100);
                progressCallback(`正在保存数据库: ${pct}% (${end}/${totalChunks})`);
            }
            
            // Critical: Yield to main thread
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    } catch (e: any) {
        console.error("DB Save failed", e);
        throw new Error(`数据库写入失败: ${e.message}`);
    }
    // --- BATCH SAVE LOGIC END ---

    return summaryData;
};

// ... keep existing functions ...

export const processKnowledgeDocument = async (fileName: string, content: string): Promise<{summary: string, entities: string[]}> => {
    return { summary: "Processing handled by ingestDocument", entities: [] };
};

// ==========================================
// 5. RAG-Enhanced Features (Multi-turn Chat)
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
    
    【当前筛选数据统计】:
    - 记录数: ${stats.count}
    - 借方总额: ${stats.totalDebit}
    - 贷方总额: ${stats.totalCredit}
    - 摘要示例: ${stats.summaries?.join('; ')}

    【相关制度上下文】:
    ${ragContext}
    
    请结合统计数据和制度进行简练回答。如果数据为空，请说明可能的原因。
  `;

  return await callAI(prompt, "你是一个专业的财务机器人，回答需有理有据。", false);
};

// New: Multi-turn Chat Handler
export const generateChatResponse = async (
    history: {role: string, content: string}[], 
    latestQuery: string, 
    stats: any
) => {
    // 1. RAG Retrieval
    const results = await searchKnowledgeBase(latestQuery, 2);
    const ragContext = results.map(r => `[制度参考: ${r.chunk.sourceTitle}] ${r.chunk.content}`).join("\n");

    const systemPrompt = `
        你是一个专业的企业财务助手 "Finance Master"。
        
        【当前用户查询的数据统计】:
        - 筛选记录数: ${stats.count}
        - 借方总额: ${stats.totalDebit}
        - 贷方总额: ${stats.totalCredit}
        - 摘要示例: ${stats.summaries?.join('; ')}
        
        【公司内部制度/知识库片段】:
        ${ragContext}

        请根据用户最新的问题和上下文历史进行回答。
        回答风格：专业、简洁、数据驱动。
    `;

    // Construct messages for API
    const messages = [
        { role: "system", content: systemPrompt },
        ...history.slice(-6), // Keep last 6 turns for context
        { role: "user", content: latestQuery }
    ];

    const apiKey = getApiKey();
    if (!apiKey) throw new Error("API Key Missing");

    // Direct fetch to support history
    const response = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: MODEL_CHAT,
            messages: messages,
            temperature: 0.3
        })
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || 'API Error';
};

export const queryKnowledgeBase = async (query: string) => {
    const results = await searchKnowledgeBase(query, 4);
    const context = results.map(r => `[出处: ${r.chunk.sourceTitle}] ${r.chunk.content}`).join("\n\n");
    const prompt = `
        用户问题: "${query}"
        【参考资料】: ${context}
        请仅根据上述参考资料回答用户问题。如果资料中没有提到，请直接说“知识库中未找到相关信息”。
    `;
    const answer = await callAI(prompt, "你是一个基于企业内部知识库的问答助手。", false);
    return { answer, sources: results.map(r => ({ ...r.chunk, score: r.score })) };
};

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
           判断合规性。记录: { 科目: "${row.subjectName}", 金额: ${row.debitAmount}, 摘要: "${row.summary}" }
           制度: "${policyChunk.content}"
           若疑似违规（超标/科目错/摘要模糊），返回 JSON: { "violation": true, "reason": "...", "severity": "high"|"medium" }
           否则返回 { "violation": false }
        `;

        try {
            const resStr = await callAI(verifyPrompt, "你是一个合规审计员，只返回JSON。", true);
            const res = JSON.parse(cleanJsonString(resStr));
            if (res.violation) {
                results.push({
                    rowId: row.id || 'unknown', voucherNo: row.voucherNo, summary: row.summary,
                    issue: res.reason, policySource: policyChunk.sourceTitle, severity: res.severity
                });
            }
        } catch (e) { }
    }
    return results;
};

// ... existing analysis functions ...
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
