
import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, CheckCircle2, Trash2, BrainCircuit, Loader2, FileUp, Sparkles, X, Users, Quote, Send, Bot, BookOpenCheck, ChevronRight, Layers, ExternalLink, Box } from 'lucide-react';
import { db } from '../db';
import { KnowledgeDocument, KnowledgeChunk } from '../types';
import { ingestDocument, queryKnowledgeBaseStream, parseDocumentWithAI, searchKnowledgeBase, getDocumentChunks } from '../services/geminiService';
import { readFileForAI } from '../utils/fileParser';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: (KnowledgeChunk & { score: number })[];
    timestamp: number;
}

const SUGGESTED_QUESTIONS = [
    "差旅费的报销标准是多少？",
    "招待费的审批流程是怎样的？",
    "固定资产折旧年限规定？"
];

const CitationRenderer = ({ text, sources, onSourceClick }: { text: string, sources?: any[], onSourceClick: (idx: number) => void }) => {
    if (!text) return null;
    const parts = text.split(/(\[\d+\])/g);

    return (
        <span>
            {parts.map((part, i) => {
                const match = part.match(/^\[(\d+)\]$/);
                if (match) {
                    const index = parseInt(match[1]) - 1; 
                    if (sources && sources[index]) {
                        return (
                            <button
                                key={i}
                                onClick={() => onSourceClick(index)}
                                className="inline-flex items-center justify-center w-4 h-4 ml-0.5 -mt-2 text-[9px] font-bold text-indigo-600 bg-indigo-100 rounded-full hover:bg-indigo-600 hover:text-white transition-colors align-top cursor-pointer border border-indigo-200"
                                title={`点击查看来源: ${sources[index].sourceTitle}`}
                            >
                                {match[1]}
                            </button>
                        );
                    }
                }
                return <span key={i}>{part}</span>;
            })}
        </span>
    );
};

const KnowledgePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'chat' | 'library'>('library');
  const [documents, setDocuments] = useState<(KnowledgeDocument & { chunkCount?: number })[]>([]);
  
  // Library State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState<string>('');
  const [processPercent, setProcessPercent] = useState<number>(0);
  const [libraryCategory, setLibraryCategory] = useState<'policy' | 'accounting_manual' | 'business_rule'>('accounting_manual');

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Preview State with Highlight Logic
  const [previewContent, setPreviewContent] = useState<{ 
      title: string, 
      mode: 'doc' | 'chunks', 
      content?: string, 
      chunks?: KnowledgeChunk[], 
      highlightChunkId?: string, 
      docId?: string 
  } | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDocuments();
  }, []);

  useEffect(() => {
    if (activeTab === 'chat') {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab]);

  // SCROLL LOGIC: Trigger scroll when preview content changes AND has a highlight request
  useEffect(() => {
      if (previewContent?.highlightChunkId && previewRef.current) {
          // Add a small delay to ensure rendering and panel expansion is complete
          setTimeout(() => {
              const element = document.getElementById(`chunk-${previewContent.highlightChunkId}`);
              if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  // Optional: Add visual flash effect handled by CSS or just relies on the bg color
              }
          }, 300);
      }
  }, [previewContent]);

  const loadDocuments = async () => {
    try {
        const docs = await db.knowledge.toArray();
        const docsWithStats = await Promise.all(docs.map(async (d) => {
            const count = await db.chunks.where('documentId').equals(d.id).count();
            return { ...d, chunkCount: count };
        }));
        setDocuments(docsWithStats.reverse());
    } catch (e) {
        console.error("Failed to load documents", e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setProcessPercent(0);
    const file = files[0];
    
    try {
        setProcessStatus(`正在读取文件 ${file.name}...`);
        const { content: fileData, mimeType, isBinary } = await readFileForAI(file);
        
        let fullText = "";

        setProcessPercent(10);
        setProcessStatus("正在进行云端 OCR 与结构化解析...");
        fullText = await parseDocumentWithAI(file, fileData, mimeType, (msg) => setProcessStatus(msg));

        if (!fullText || fullText.trim().length < 10) {
            throw new Error("未能提取到有效文本，请检查文件。");
        }
        
        setProcessPercent(50); 
        setProcessStatus("AI 正在理解文档并构建向量索引...");
        const docId = `doc-${Date.now()}`;
        
        const { summary, entities, rules } = await ingestDocument(docId, file.name, fullText, (stage) => setProcessStatus(stage));
        
        const enrichedSummary = summary + (rules && rules.length > 0 ? "\n\n[关键规则]: " + rules.slice(0,3).join("; ") : "");

        const newDoc: KnowledgeDocument = {
            id: docId,
            title: file.name.replace(/\.[^/.]+$/, ""),
            content: fullText,
            summary: enrichedSummary,
            entities: entities,
            category: libraryCategory,
            uploadDate: new Date().toLocaleString(),
            status: 'active'
        };

        await db.knowledge.add(newDoc);
        await loadDocuments();
        
        e.target.value = ''; 
        setProcessPercent(100);
        setProcessStatus("处理完成！");
        setTimeout(() => { setIsProcessing(false); setProcessStatus(''); }, 1500);

    } catch (err: any) {
        console.error(err);
        alert(err.message || "处理失败");
        setIsProcessing(false);
        setProcessStatus('');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if(confirm('确定要删除这份文档吗？')) {
          await db.knowledge.delete(id);
          await db.chunks.where('documentId').equals(id).delete();
          setDocuments(prev => prev.filter(d => d.id !== id));
      }
  };

  const handleSendMessage = async (textOverride?: string) => {
      const text = textOverride || chatInput;
      if (!text.trim()) return;

      const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now() };
      setMessages(prev => [...prev, userMsg]);
      setChatInput('');
      setIsChatLoading(true);

      const botMsgId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, { 
          id: botMsgId, 
          role: 'assistant', 
          content: '', 
          timestamp: Date.now() 
      }]);

      try {
          const stream = queryKnowledgeBaseStream(text);
          let fullText = '';
          
          for await (const chunk of stream) {
              if (chunk.type === 'sources') {
                  setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, sources: chunk.sources } : m));
              } else if (chunk.type === 'text') {
                  fullText += chunk.content;
                  setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, content: fullText } : m));
              }
          }
      } catch (e) {
          setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, content: "AI 服务连接中断。" } : m));
      } finally {
          setIsChatLoading(false);
      }
  };

  // Improved Source Preview Trigger
  const openSourcePreview = (chunk: KnowledgeChunk) => {
      const doc = documents.find(d => d.id === chunk.documentId);
      if (!doc) return;

      setPreviewContent({
          title: chunk.sourceTitle,
          mode: 'doc',
          content: doc.content,
          highlightChunkId: chunk.id, // Pass ID for robust scrolling
          docId: doc.id
      });
  };

  const openChunkView = async (docId: string, title: string) => {
      try {
          const chunks = await getDocumentChunks(docId);
          setPreviewContent({
              title: title,
              mode: 'chunks',
              chunks: chunks
          });
      } catch (e) {
          console.error("Failed to load chunks", e);
      }
  };

  // Helper to highlight text within the full document content
  // Since we don't have exact offset storage, we do a split-based approximation which is usually good enough for RAG.
  // Note: For perfect precision, one would store start/end indices in ingestDocument. 
  // Here we use a visual marker approach based on finding the text.
  const renderHighlightedContent = (fullText: string, highlightId: string | undefined) => {
      // If we have a highlight ID, we need to find the text of that chunk.
      // But we passed the ID, not the text. We should fetch chunks for this doc to match.
      // Optimization: We fetch chunks once when opening doc view.
      return <AsyncDocumentRenderer fullText={fullText} highlightId={highlightId} docId={previewContent?.docId} />;
  };

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      {/* Header Tabs */}
      <div className="flex items-center justify-between mb-6 shrink-0">
          <div className="flex bg-white p-1 rounded-xl shadow-sm border border-slate-100">
              <button 
                  onClick={() => setActiveTab('library')}
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'library' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <BookOpenCheck size={16} /> 资料库 (AI 训练)
              </button>
              <button 
                  onClick={() => setActiveTab('chat')}
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'chat' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                  <Bot size={16} /> 智能问答
              </button>
          </div>
          {isProcessing && (
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full animate-pulse">
                  <Loader2 size={12} className="animate-spin" />
                  <span>{processStatus} {processPercent}%</span>
              </div>
          )}
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        
        {/* Left Panel: Content */}
        <div className={`flex flex-col transition-all duration-300 ${previewContent ? 'w-1/2' : 'w-full'}`}>
            
            {activeTab === 'library' && (
                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 h-full overflow-y-auto">
                    {/* Upload Area */}
                    <div className="mb-8 p-6 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 hover:border-indigo-300 transition-colors flex flex-col items-center justify-center text-center relative group">
                        <input type="file" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={handleFileUpload} disabled={isProcessing} accept=".pdf,.doc,.docx,.txt" />
                        <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4 text-indigo-500 group-hover:scale-110 transition-transform">
                            {isProcessing ? <Loader2 size={32} className="animate-spin" /> : <FileUp size={32} />}
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">上传财务制度文件</h3>
                        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                            AI 将自动进行全文 OCR、语义理解、规则提取和向量化索引。
                            <br />支持 PDF, Word (Docx), TXT。
                        </p>
                    </div>

                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Layers size={18} className="text-slate-400" />
                        已收录文档 ({documents.length})
                    </h3>
                    
                    <div className="grid grid-cols-1 gap-4">
                        {documents.map(doc => (
                            <div key={doc.id} className="group relative p-5 rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all bg-white">
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 bg-slate-50 rounded-lg text-blue-600">
                                            <FileText size={24} />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800">{doc.title}</h4>
                                            <div className="flex gap-2 text-xs text-slate-400 mt-1 items-center">
                                                <span>{doc.uploadDate}</span>
                                                <span>•</span>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); openChunkView(doc.id, doc.title); }}
                                                    className="flex items-center gap-1 text-emerald-600 font-medium hover:underline hover:text-emerald-800 transition-colors bg-emerald-50 px-2 py-0.5 rounded cursor-pointer"
                                                    title="点击查看所有切片详情"
                                                >
                                                    <Box size={10} />
                                                    {doc.chunkCount} 个知识切片
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={(e) => handleDelete(e, doc.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-all">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                
                                <div className="mt-4 pt-4 border-t border-slate-50">
                                    <div className="flex items-start gap-2">
                                        <Sparkles size={14} className="text-purple-500 mt-0.5 shrink-0" />
                                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                                            {doc.summary}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'chat' && (
                <div className="bg-white rounded-3xl border border-slate-100 shadow-xl h-full flex flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scrollbar-thin">
                        {messages.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                                <BrainCircuit size={64} className="text-indigo-200 mb-6" />
                                <h2 className="text-xl font-bold text-slate-700 mb-2">我是您的 AI 财务专家</h2>
                                <p className="text-slate-500 max-w-sm mb-8">我已经学习了您的财务制度库，您可以问我关于报销标准、合规流程或预算规定的任何问题。</p>
                                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                                    {SUGGESTED_QUESTIONS.map((q,i) => (
                                        <button key={i} onClick={() => handleSendMessage(q)} className="px-4 py-2 bg-white border border-slate-200 rounded-full text-xs font-bold text-slate-600 hover:border-indigo-500 hover:text-indigo-600 transition-all">
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map(msg => (
                            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-white text-slate-600' : 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white'}`}>
                                    {msg.role === 'user' ? <Users size={20} /> : <Bot size={20} />}
                                </div>
                                <div className="max-w-[85%] space-y-2">
                                    <div className={`p-5 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-slate-800 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none text-slate-700'}`}>
                                        <CitationRenderer 
                                            text={msg.content} 
                                            sources={msg.sources}
                                            onSourceClick={(idx) => msg.sources && msg.sources[idx] && openSourcePreview(msg.sources[idx])}
                                        />
                                        {msg.role === 'assistant' && !msg.content && isChatLoading && (
                                            <span className="animate-pulse">Thinking...</span>
                                        )}
                                    </div>
                                    
                                    {msg.sources && msg.sources.length > 0 && (
                                        <div className="flex flex-wrap gap-2 pl-2">
                                            <div className="text-[10px] text-slate-400 font-bold uppercase w-full mb-1">参考资料来源</div>
                                            {msg.sources.map((src, i) => (
                                                <button 
                                                    key={i}
                                                    onClick={() => openSourcePreview(src)}
                                                    className="flex items-center gap-1.5 px-2 py-1 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded text-[10px] text-slate-500 hover:text-indigo-600 transition-all group"
                                                >
                                                    <span className="font-mono font-bold bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 rounded px-1">{i + 1}</span>
                                                    <span className="truncate max-w-[100px]">{src.sourceTitle}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef}></div>
                    </div>

                    <div className="p-4 bg-white border-t border-slate-100 shrink-0">
                        <div className="relative">
                            <input 
                                type="text"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                placeholder="输入问题，AI 将引用原文回答..."
                                className="w-full pl-5 pr-14 py-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 transition-all"
                                disabled={isChatLoading}
                            />
                            <button 
                                onClick={() => handleSendMessage()}
                                disabled={!chatInput.trim() || isChatLoading}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all shadow-md shadow-indigo-200"
                            >
                                <Send size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* Right Panel: Preview (Collapsible) */}
        {previewContent && (
            <div className="w-1/2 bg-white rounded-3xl border border-slate-100 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right-10 duration-300 z-10">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-sm text-indigo-600">
                            {previewContent.mode === 'chunks' ? <Layers size={18} /> : <FileText size={18} />}
                        </div>
                        <div>
                            <div className="text-[10px] uppercase font-bold text-slate-400">
                                {previewContent.mode === 'chunks' ? '知识切片概览' : '文档来源预览'}
                            </div>
                            <h3 className="font-bold text-slate-800 text-sm truncate max-w-[200px]" title={previewContent.title}>{previewContent.title}</h3>
                        </div>
                    </div>
                    <button onClick={() => setPreviewContent(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-0 bg-white relative" ref={previewRef}>
                    {previewContent.mode === 'doc' ? (
                        <div className="prose prose-sm prose-slate max-w-none p-8">
                            {renderHighlightedContent(previewContent.content || '', previewContent.highlightChunkId)}
                        </div>
                    ) : previewContent.mode === 'chunks' && previewContent.chunks ? (
                        <div className="p-4 space-y-3 bg-slate-50/50">
                            {previewContent.chunks.map((chunk, idx) => (
                                <div key={chunk.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm hover:border-indigo-200 transition-all">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                            切片 #{idx + 1}
                                        </span>
                                        <span className="text-[10px] text-slate-300 font-mono">
                                            Length: {chunk.content.length}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed font-mono whitespace-pre-wrap">
                                        {chunk.content}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>
            </div>
        )}

      </div>
    </div>
  );
};

// Async component to match and highlight text using chunks
const AsyncDocumentRenderer = ({ fullText, highlightId, docId }: { fullText: string, highlightId?: string, docId?: string }) => {
    const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
    const [status, setStatus] = useState<'loading'|'ready'>('loading');

    useEffect(() => {
        if (!docId) { setStatus('ready'); return; }
        getDocumentChunks(docId).then(data => {
            setChunks(data);
            setStatus('ready');
        });
    }, [docId]);

    if (status === 'loading') return <div className="flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin" size={14}/> 加载原文中...</div>;

    if (!highlightId) {
        return <div className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-600">{fullText}</div>;
    }

    // Find the highlight chunk text
    const targetChunk = chunks.find(c => c.id === highlightId);
    if (!targetChunk) return <div className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-600">{fullText}</div>;

    // Use split by the exact chunk content to insert the highlight mark
    // Note: This relies on exact string match. If normalization differed, we fallback to just text.
    // A robust system would store start/end offsets.
    const parts = fullText.split(targetChunk.content);
    
    // If not found (due to slight cleaning diffs), we just return text. 
    // Improvement: Normalize both before matching, or use approximate find. 
    // For now, if exact match fails, we try to match the first 50 chars as a heuristic anchor.
    if (parts.length === 1) {
         // Fallback heuristic: Try to find a distinctive substring
         const heuristic = targetChunk.content.substring(0, 50);
         const heuristicParts = fullText.split(heuristic);
         
         if (heuristicParts.length > 1) {
             return (
                <div className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-600">
                    {heuristicParts.map((part, i) => (
                        <React.Fragment key={i}>
                            {part}
                            {i < heuristicParts.length - 1 && (
                                <mark 
                                    id={`chunk-${highlightId}`} 
                                    className="bg-yellow-200 text-slate-900 px-1 rounded mx-0.5 border-b-2 border-yellow-400 font-bold animate-pulse shadow-sm"
                                >
                                    {heuristic}
                                    {/* We only highlighted the first 50 chars, let's just show the rest of the chunk as normal text immediately after if possible, or just accept the anchor highlight */}
                                    <span className="bg-yellow-50 font-normal border-none text-slate-500">...</span>
                                </mark>
                            )}
                        </React.Fragment>
                    ))}
                </div>
             );
         }
         return <div className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-600">{fullText}</div>;
    }

    return (
        <div className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-600">
            {parts.map((part, i) => (
                <React.Fragment key={i}>
                    {part}
                    {i < parts.length - 1 && (
                        <mark 
                            id={`chunk-${highlightId}`} 
                            className="bg-yellow-200 text-slate-900 px-1 rounded mx-0.5 border-b-2 border-yellow-400 font-bold animate-pulse shadow-sm"
                        >
                            {targetChunk.content}
                        </mark>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};

export default KnowledgePage;
