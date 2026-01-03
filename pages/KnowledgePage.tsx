
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, FileText, CheckCircle2, Trash2, BrainCircuit, Loader2, FileUp, Sparkles, X, Users, Quote, Send, Bot, BookOpenCheck, ChevronRight, Layers, ExternalLink, Box, Lightbulb, RotateCcw, Copy, Check, Search } from 'lucide-react';
import { db } from '../db';
import { KnowledgeDocument, KnowledgeChunk } from '../types';
import { ingestDocument, queryKnowledgeBaseStream, parseDocumentWithAI, searchKnowledgeBase, getDocumentChunks } from '../services/geminiService';
import { readFileForAI } from '../utils/fileParser';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: (KnowledgeChunk & { score: number })[];
    timestamp: number;
}

// Fallback suggestions if no docs present
const DEFAULT_SUGGESTIONS = [
    "差旅费的报销标准是多少？",
    "招待费的审批流程是怎样的？",
    "固定资产折旧年限规定？"
];

const MarkdownRenderer = ({ content, onSourceClick }: { content: string, onSourceClick: (idx: number) => void }) => {
    // 1. Pre-process content: Convert [1] -> [1](#source-1)
    // Using hash links ensures standard markdown parsers treat them as internal links, 
    // which we can then intercept easily.
    const processedContent = useMemo(() => {
        if (!content) return '';
        // Match [1], [ 1 ], 【1】 patterns globally and convert to internal anchor format
        return content.replace(/\[\s*(\d+)\s*\]/g, '[$1](#source-$1)')
                      .replace(/【\s*(\d+)\s*】/g, '[$1](#source-$1)')
                      .replace(/\（\s*(\d+)\s*\）/g, '[$1](#source-$1)'); 
    }, [content]);

    return (
        <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            className="prose prose-sm prose-slate max-w-none break-words"
            components={{
                a: ({ node, href, children, ...props }) => {
                    // 2. Intercept Citation Links (Check for our specific hash pattern)
                    if (href && href.startsWith('#source-')) {
                        // Extract index from "#source-1"
                        const indexStr = href.replace('#source-', '');
                        const index = parseInt(indexStr) - 1;
                        
                        return (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault(); 
                                    e.stopPropagation();
                                    if (!isNaN(index) && index >= 0) {
                                        onSourceClick(index);
                                    }
                                }}
                                className="inline-flex items-center justify-center w-4 h-4 mx-0.5 text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full hover:bg-indigo-600 hover:text-white transition-all align-top -mt-1 cursor-pointer select-none shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                title="点击查看来源原文"
                            >
                                {children}
                            </button>
                        );
                    }
                    
                    // 3. Regular Links (External) - Open in new tab
                    return (
                        <a 
                            href={href} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-blue-600 hover:underline inline-flex items-center gap-0.5" 
                            onClick={(e) => e.stopPropagation()}
                            {...props}
                        >
                            {children} <ExternalLink size={10} />
                        </a>
                    );
                },
                table: ({node, ...props}) => <div className="overflow-x-auto my-2"><table className="min-w-full border border-slate-200 rounded-lg text-xs" {...props} /></div>,
                thead: ({node, ...props}) => <thead className="bg-slate-50" {...props} />,
                th: ({node, ...props}) => <th className="p-2 text-left font-bold text-slate-700 border-b border-slate-200" {...props} />,
                td: ({node, ...props}) => <td className="p-2 border-b border-slate-100 text-slate-600" {...props} />,
                code: ({node, className, children, ...props}) => { 
                    const match = /language-(\w+)/.exec(className || '')
                    return !className ? (
                        <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono text-xs" {...props}>
                            {children}
                        </code>
                    ) : (
                        <code className={className} {...props}>
                            {children}
                        </code>
                    )
                }
            }}
        >
            {processedContent}
        </ReactMarkdown>
    );
};

const KnowledgePage: React.FC = () => {
  // Session Storage Keys
  const STORAGE_KEY_HISTORY = 'know_chat_history';
  const STORAGE_KEY_INPUT = 'know_chat_input';

  const [activeTab, setActiveTab] = useState<'chat' | 'library'>('library');
  const [documents, setDocuments] = useState<(KnowledgeDocument & { chunkCount?: number })[]>([]);
  
  // Library State
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState<string>('');
  const [processPercent, setProcessPercent] = useState<number>(0);
  const [libraryCategory, setLibraryCategory] = useState<'policy' | 'accounting_manual' | 'business_rule'>('accounting_manual');

  // Chat State with Persistence
  const [chatInput, setChatInput] = useState(() => sessionStorage.getItem(STORAGE_KEY_INPUT) || '');
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  // Initialize messages from sessionStorage
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
      try {
          const saved = sessionStorage.getItem(STORAGE_KEY_HISTORY);
          return saved ? JSON.parse(saved) : [];
      } catch (e) {
          console.warn("Failed to parse chat history", e);
          return [];
      }
  });
  
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

  // --- Persistence Logic ---
  useEffect(() => {
      const safeHistory = messages.map(msg => ({
          ...msg,
          sources: msg.sources?.map(s => {
              const { embedding, ...rest } = s; 
              return rest as any;
          })
      }));
      sessionStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(safeHistory));
  }, [messages]);

  useEffect(() => {
      sessionStorage.setItem(STORAGE_KEY_INPUT, chatInput);
  }, [chatInput]);

  useEffect(() => {
    if (activeTab === 'chat') {
        setTimeout(() => {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
  }, [messages, activeTab]);

  useEffect(() => {
      if (previewContent?.highlightChunkId && previewRef.current) {
          setTimeout(() => {
              const element = document.getElementById(`chunk-${previewContent.highlightChunkId}`);
              if (element) {
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  // Compute Dynamic Suggestions (Shuffled & Randomized)
  const dynamicSuggestions = useMemo(() => {
      if (documents.length === 0) return DEFAULT_SUGGESTIONS;
      const allQuestions = documents.flatMap(d => d.suggestedQuestions || []).filter(q => q && q.length > 4);
      if (allQuestions.length === 0) return DEFAULT_SUGGESTIONS;
      const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
      const unique = Array.from(new Set(shuffled)).slice(0, 4);
      return unique.length > 0 ? unique : DEFAULT_SUGGESTIONS;
  }, [documents]);

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
        
        const { summary, entities, rules, suggestedQuestions } = await ingestDocument(docId, file.name, fullText, (stage) => setProcessStatus(stage));
        
        const enrichedSummary = summary + (rules && rules.length > 0 ? "\n\n[关键规则]: " + rules.slice(0,3).join("; ") : "");

        const newDoc: KnowledgeDocument = {
            id: docId,
            title: file.name.replace(/\.[^/.]+$/, ""),
            content: fullText,
            summary: enrichedSummary,
            entities: entities,
            category: libraryCategory,
            uploadDate: new Date().toLocaleString(),
            status: 'active',
            suggestedQuestions: suggestedQuestions
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

  const handleClearChat = () => {
      if(confirm("确定要清空历史对话记录吗？")) {
          setMessages([]);
          sessionStorage.removeItem(STORAGE_KEY_HISTORY);
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

  const openSourcePreview = (chunk: KnowledgeChunk) => {
      const doc = documents.find(d => d.id === chunk.documentId);
      if (!doc) return;

      setPreviewContent({
          title: chunk.sourceTitle,
          mode: 'doc',
          content: doc.content,
          highlightChunkId: chunk.id,
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

  const renderHighlightedContent = (fullText: string, highlightId: string | undefined) => {
      return <AsyncDocumentRenderer fullText={fullText} highlightId={highlightId} docId={previewContent?.docId} />;
  };

  const CopyButton = ({ text }: { text: string }) => {
      const [copied, setCopied] = useState(false);
      const handleCopy = () => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      };
      return (
          <button 
            onClick={handleCopy} 
            className="p-1.5 text-slate-400 hover:text-indigo-600 bg-white/50 hover:bg-white rounded-lg transition-all"
            title="复制回答"
          >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          </button>
      );
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
                                    {dynamicSuggestions.map((q,i) => (
                                        <button key={i} onClick={() => handleSendMessage(q)} className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 rounded-full text-xs font-bold text-slate-600 hover:border-indigo-500 hover:text-indigo-600 transition-all">
                                            <Lightbulb size={12} className="text-yellow-500"/> {q}
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
                                <div className="max-w-[85%] space-y-2 group">
                                    <div className={`p-5 rounded-2xl text-sm leading-relaxed shadow-sm relative ${msg.role === 'user' ? 'bg-slate-800 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none text-slate-700'}`}>
                                        
                                        {msg.role === 'assistant' && (
                                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <CopyButton text={msg.content} />
                                            </div>
                                        )}

                                        {msg.role === 'assistant' ? (
                                            <MarkdownRenderer 
                                                content={msg.content} 
                                                onSourceClick={(idx) => msg.sources && msg.sources[idx] && openSourcePreview(msg.sources[idx])} 
                                            />
                                        ) : (
                                            <p className="whitespace-pre-wrap">{msg.content}</p>
                                        )}

                                        {msg.role === 'assistant' && !msg.content && isChatLoading && (
                                            <div className="flex gap-1 py-1">
                                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></div>
                                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-75"></div>
                                                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Sources displayed AFTER the bubble content wrapper for better flow, or bottom of bubble */}
                                    {msg.sources && msg.sources.length > 0 && (
                                        <div className="flex flex-wrap gap-2 pl-2 mt-1">
                                            {/* Status Header - REMOVED CONDITIONAL TEXT to avoid "Reading" stuck state */}
                                            <div className="text-[10px] text-slate-400 font-bold uppercase w-full flex items-center gap-1.5 mb-1">
                                                <BookOpenCheck size={12} className="text-emerald-500" />
                                                已检索到 {msg.sources.length} 处相关参考资料
                                            </div>
                                            
                                            {msg.sources.map((src, i) => (
                                                <button 
                                                    key={i}
                                                    onClick={() => openSourcePreview(src)}
                                                    // Show Snippet Preview on Hover for context differentiation
                                                    title={src.content.substring(0, 300) + '...'}
                                                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-lg text-[10px] text-slate-600 hover:text-indigo-700 transition-all group shadow-sm max-w-[200px]"
                                                >
                                                    <span className="font-mono font-bold bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 rounded px-1 min-w-[20px] text-center">
                                                        {i + 1}
                                                    </span>
                                                    <div className="flex flex-col text-left overflow-hidden">
                                                        <span className="truncate font-bold">{src.sourceTitle}</span>
                                                        {/* Optional: Show small hash ID to visually distinguish same-doc chunks */}
                                                        <span className="text-[9px] text-slate-400 opacity-60">
                                                            段落 #{src.id.split('-').pop()}
                                                        </span>
                                                    </div>
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
                            {messages.length > 0 && (
                                <button 
                                    onClick={handleClearChat}
                                    className="absolute right-14 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="清空记录"
                                >
                                    <RotateCcw size={16} />
                                </button>
                            )}
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
    const parts = fullText.split(targetChunk.content);
    
    // Fallback if not exact match found
    if (parts.length === 1) {
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
