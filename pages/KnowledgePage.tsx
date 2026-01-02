
import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle2, Trash2, BookOpen, BrainCircuit, Loader2, FileUp, Network, Link, Search, Sparkles, MessageSquare, Quote, X, Users, Lightbulb, ArrowRight, Eye, Layers } from 'lucide-react';
import { db } from '../db';
import { KnowledgeDocument, KnowledgeChunk } from '../types';
import { ingestDocument, queryKnowledgeBase } from '../services/geminiService';
import { extractTextFromFile } from '../utils/fileParser';

interface SearchResult {
    answer: string;
    sources: (KnowledgeChunk & { score: number })[];
}

const SUGGESTED_QUESTIONS = [
    "差旅费的报销标准是多少？",
    "研发费用资本化的条件是什么？",
    "招待费的审批流程是怎样的？",
    "固定资产折旧年限规定？"
];

const KnowledgePage: React.FC = () => {
  const [documents, setDocuments] = useState<(KnowledgeDocument & { chunkCount?: number })[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState<string>('');
  const [processPercent, setProcessPercent] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'policy' | 'accounting_manual' | 'business_rule'>('accounting_manual');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);

  // Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDocument | null>(null);
  const [previewChunks, setPreviewChunks] = useState<KnowledgeChunk[]>([]);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
        // Load ALL documents (Shared Knowledge Base)
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
        // 1. Extract Text
        setProcessStatus(`准备解析 ${file.name}...`);
        
        // Pass progress callback to parser
        const content = await extractTextFromFile(file, (pct, msg) => {
            setProcessPercent(pct);
            setProcessStatus(msg);
        });

        if (!content || content.trim().length < 10) {
            throw new Error("未能提取到有效文本，请检查文件是否为空或为纯图片扫描件。");
        }
        
        // 2. Ingest (Chunk -> Graph -> Embed -> Save)
        setProcessPercent(100); // Parsing done
        const docId = `doc-${Date.now()}`;
        const { summary, entities } = await ingestDocument(docId, file.name, content, (stage) => setProcessStatus(stage));
        
        // 3. Save Document Meta
        const newDoc: KnowledgeDocument = {
            id: docId,
            title: file.name.replace(/\.[^/.]+$/, ""),
            content: content,
            summary: summary,
            entities: entities,
            category: activeTab,
            uploadDate: new Date().toLocaleString(),
            status: 'active'
        };

        await db.knowledge.add(newDoc);
        await loadDocuments();
        
        e.target.value = ''; 
    } catch (err: any) {
        console.error(err);
        alert(err.message || "处理失败");
    } finally {
        setIsProcessing(false);
        setProcessStatus('');
        setProcessPercent(0);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();

      if(confirm('确定要删除这份文档吗？相关的知识切片和向量索引也将被移除。')) {
          try {
              await db.knowledge.delete(id);
              await db.chunks.where('documentId').equals(id).delete();
              setDocuments(prev => prev.filter(d => d.id !== id));
          } catch (err) {
              console.error("Delete failed", err);
              alert("删除失败，请刷新重试");
              loadDocuments();
          }
      }
  };

  const handleSearch = async (queryOverride?: string) => {
      const q = queryOverride || searchQuery;
      if(!q.trim()) return;
      
      setSearchQuery(q);
      setIsSearching(true);
      setSearchResult(null);
      
      try {
          const res = await queryKnowledgeBase(q);
          setSearchResult(res);
      } catch(e) {
          console.error(e);
          alert("检索失败，请检查网络或稍后再试");
      } finally {
          setIsSearching(false);
      }
  };

  const openPreview = async (doc: KnowledgeDocument) => {
      setPreviewDoc(doc);
      // Load chunks for this doc
      const chunks = await db.chunks.where('documentId').equals(doc.id).toArray();
      setPreviewChunks(chunks);
  };

  const getRelatedDocs = (currentDoc: KnowledgeDocument) => {
      if (!currentDoc.entities || currentDoc.entities.length === 0) return [];
      return documents.filter(d => 
          d.id !== currentDoc.id && 
          d.entities?.some(e => currentDoc.entities?.includes(e))
      ).slice(0, 3);
  };

  const getFileIcon = (title: string) => {
      if (title.endsWith('.pdf')) return <FileText size={24} className="text-red-500" />;
      if (title.endsWith('.doc') || title.endsWith('.docx')) return <FileText size={24} className="text-blue-500" />;
      return <FileText size={24} className="text-slate-500" />;
  };

  const getScoreColor = (score: number) => {
      if(score > 0.8) return 'text-emerald-600 bg-emerald-50 border-emerald-100';
      if(score > 0.6) return 'text-blue-600 bg-blue-50 border-blue-100';
      return 'text-amber-600 bg-amber-50 border-amber-100';
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20 relative">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 p-8 rounded-3xl text-white shadow-xl relative overflow-hidden">
         <div className="relative z-10">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-3xl font-bold mb-2 flex items-center gap-3">
                        <BrainCircuit size={32} className="text-violet-200" />
                        集团共享知识库
                    </h2>
                    <p className="text-violet-100 opacity-90 max-w-2xl text-sm">
                        这里存储了<b>所有主体共用</b>的财务制度与核算标准。基于向量引擎，为您提供精准的语义检索。
                    </p>
                </div>
                <div className="hidden md:flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
                    <Users size={14} className="text-violet-200"/>
                    <span className="text-xs font-bold text-violet-100">全员共享资源</span>
                </div>
            </div>
         </div>
         <div className="absolute right-0 top-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
      </div>

      {/* 🔍 Search Playground */}
      <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 to-indigo-500"></div>
          
          <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="请输入您想咨询的财务问题..."
                    className="w-full pl-12 pr-10 py-4 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white transition-all placeholder:font-normal placeholder:text-slate-400"
                  />
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                  {searchQuery && (
                      <button onClick={() => {setSearchQuery(''); setSearchResult(null);}} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                          <X size={16} />
                      </button>
                  )}
              </div>
              <button 
                onClick={() => handleSearch()}
                disabled={isSearching || !searchQuery.trim()}
                className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-indigo-200 whitespace-nowrap"
              >
                  {isSearching ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                  <span>AI 检索</span>
              </button>
          </div>

          {/* Quick Suggestions */}
          {!searchResult && !isSearching && (
              <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex items-center gap-1 text-slate-400 text-xs font-bold mr-2">
                      <Lightbulb size={12} /> 猜你想问:
                  </div>
                  {SUGGESTED_QUESTIONS.map((q, i) => (
                      <button 
                        key={i}
                        onClick={() => handleSearch(q)}
                        className="px-3 py-1 bg-slate-50 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 text-xs rounded-full border border-slate-200 hover:border-indigo-100 transition-colors"
                      >
                          {q}
                      </button>
                  ))}
              </div>
          )}

          {/* Search Results */}
          {searchResult && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-4 mt-6">
                  {/* AI Answer */}
                  <div className="md:col-span-2 space-y-4">
                      <div className="p-6 bg-indigo-50/50 rounded-2xl border border-indigo-100 relative">
                          <div className="absolute -top-3 -left-3 bg-white p-2 rounded-full shadow-sm border border-indigo-50">
                              <MessageSquare size={20} className="text-indigo-600" />
                          </div>
                          <h4 className="font-bold text-indigo-900 mb-2 ml-2">AI 综合回答</h4>
                          <p className="text-slate-700 leading-relaxed text-sm whitespace-pre-line ml-2">
                              {searchResult.answer}
                          </p>
                      </div>
                  </div>

                  {/* Sources / Evidence */}
                  <div className="md:col-span-1 space-y-3">
                      <div className="flex items-center gap-2 text-slate-400 font-bold text-xs uppercase tracking-wider mb-1">
                          <Quote size={12} /> 知识来源 (引用片段)
                      </div>
                      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin">
                          {searchResult.sources.map((src, idx) => (
                              <div key={idx} className="p-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:border-indigo-200 transition-colors group relative cursor-help">
                                  <div className={`absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-bold border ${getScoreColor(src.score)}`}>
                                      匹配度 {(src.score * 100).toFixed(0)}%
                                  </div>
                                  <div className="flex items-center gap-2 mb-2">
                                      <FileText size={12} className="text-slate-400" />
                                      <div className="text-xs font-bold text-slate-700 truncate pr-16" title={src.sourceTitle}>
                                          {src.sourceTitle}
                                      </div>
                                  </div>
                                  <p className="text-[11px] text-slate-500 line-clamp-4 leading-relaxed group-hover:text-slate-700 bg-slate-50 p-2 rounded border border-slate-100">
                                      ...{src.content}...
                                  </p>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          )}
      </div>

      {/* Document Library */}
      <div className="flex flex-col gap-6 mt-8">
         <div className="flex items-center justify-between">
             <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                 <BookOpen size={20} className="text-slate-400" />
                 文档列表
             </h3>
             
             {/* Upload Button */}
             <div className="relative">
                <input 
                    type="file" 
                    id="doc-upload" 
                    className="hidden" 
                    accept=".txt,.md,.json,.csv,.doc,.docx,.pdf" 
                    onChange={handleFileUpload}
                    disabled={isProcessing}
                />
                <label 
                    htmlFor="doc-upload" 
                    className={`flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-xl cursor-pointer hover:bg-slate-800 transition-all shadow-lg ${isProcessing ? 'opacity-70 cursor-wait' : ''}`}
                >
                    {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                    <span>{isProcessing ? `解析中 ${processPercent}%` : '上传制度文档'}</span>
                </label>
             </div>
         </div>

         {/* Tabs */}
         <div className="flex gap-2 border-b border-slate-200 pb-1">
             {[
                 { id: 'accounting_manual', label: '会计核算手册' },
                 { id: 'policy', label: '报销制度与标准' },
                 { id: 'business_rule', label: '业务指引' }
             ].map(tab => (
                 <button 
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === tab.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                 >
                     {tab.label}
                 </button>
             ))}
         </div>
         
         {/* Loading Status */}
         {isProcessing && (
            <div className="flex items-center justify-center p-8 bg-indigo-50/50 rounded-2xl border border-indigo-100 animate-pulse">
                <div className="flex flex-col items-center gap-2">
                    <div className="text-indigo-600 font-medium flex items-center gap-3">
                        <Loader2 size={24} className="animate-spin" />
                        <span className="text-lg">{processStatus || '正在解析文档...'}</span>
                    </div>
                    {processPercent > 0 && processPercent < 100 && (
                        <div className="w-64 h-2 bg-indigo-100 rounded-full mt-2 overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${processPercent}%` }}></div>
                        </div>
                    )}
                </div>
            </div>
         )}

         {/* Document List Items */}
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {documents.filter(d => d.category === activeTab).map(doc => {
                 const relatedDocs = getRelatedDocs(doc);
                 return (
                 <div key={doc.id} className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group flex flex-col relative">
                     <div className="flex justify-between items-start mb-3">
                         <div className="flex items-center gap-3 overflow-hidden">
                             <div className="p-2.5 bg-slate-50 text-slate-600 rounded-xl shrink-0">
                                 {getFileIcon(doc.title)}
                             </div>
                             <div className="min-w-0">
                                 <h3 className="font-bold text-slate-800 text-sm truncate" title={doc.title}>{doc.title}</h3>
                                 <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                                     <span>{doc.uploadDate.split(' ')[0]}</span>
                                     <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                                     <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={10} /> 已索引 ({doc.chunkCount || 0} 片)</span>
                                 </div>
                             </div>
                         </div>
                         <div className="flex gap-2">
                            <button 
                                onClick={() => openPreview(doc)}
                                className="p-1.5 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="查看解析内容"
                            >
                                <Eye size={16} />
                            </button>
                            <button 
                                onClick={(e) => handleDelete(e, doc.id)} 
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                                <Trash2 size={16} />
                            </button>
                         </div>
                     </div>
                     
                     <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 bg-slate-50 p-2 rounded mb-3 flex-1">
                         {doc.summary}
                     </p>

                     <div className="flex items-center gap-2 border-t border-slate-50 pt-3 mt-auto">
                        <Network size={12} className="text-violet-400" />
                        <div className="flex gap-1 overflow-hidden">
                            {doc.entities?.slice(0, 3).map((e, i) => (
                                <span key={i} className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded whitespace-nowrap">{e}</span>
                            ))}
                            {(doc.entities?.length || 0) > 3 && <span className="text-[10px] text-slate-400">...</span>}
                        </div>
                     </div>
                 </div>
                 );
             })}
         </div>

         {documents.filter(d => d.category === activeTab).length === 0 && !isProcessing && (
             <div className="text-center py-16 bg-white rounded-3xl border-2 border-dashed border-slate-100">
                 <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                     <FileUp size={32} />
                 </div>
                 <h3 className="font-bold text-slate-400">该分类下暂无文档</h3>
                 <p className="text-xs text-slate-400 mt-1">所有主体共享同一套知识库，请上传通用制度文件</p>
             </div>
         )}
      </div>

      {/* === Document Preview Modal === */}
      {previewDoc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><FileText size={20} /></div>
                          <div>
                              <h3 className="font-bold text-slate-800 text-lg">{previewDoc.title}</h3>
                              <div className="flex gap-2 text-xs text-slate-500">
                                  <span>{previewDoc.chunkCount || previewChunks.length} 个切片</span>
                                  <span>•</span>
                                  <span>{previewDoc.content.length} 字符</span>
                              </div>
                          </div>
                      </div>
                      <button onClick={() => setPreviewDoc(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
                          <X size={20} />
                      </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 flex gap-6">
                      {/* Left: Raw Content */}
                      <div className="flex-1">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                              <FileText size={14} /> 解析后的纯文本 (Raw Text)
                          </h4>
                          <div className="bg-slate-50 rounded-xl p-4 text-xs font-mono text-slate-600 whitespace-pre-wrap leading-relaxed border border-slate-100 h-[calc(100%-2rem)] overflow-y-auto">
                              {previewDoc.content}
                          </div>
                      </div>

                      {/* Right: Chunks */}
                      <div className="flex-1">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                              <Layers size={14} /> 向量切片预览 (Chunks)
                          </h4>
                          <div className="space-y-3 h-[calc(100%-2rem)] overflow-y-auto pr-1">
                              {previewChunks.map((chunk, idx) => (
                                  <div key={idx} className="p-3 bg-white border border-indigo-100 rounded-xl shadow-sm hover:border-indigo-300 transition-all text-xs">
                                      <div className="flex justify-between items-center mb-1">
                                          <span className="font-bold text-indigo-600">Chunk #{idx + 1}</span>
                                          <span className="text-slate-300 text-[10px]">{chunk.content.length} chars</span>
                                      </div>
                                      <p className="text-slate-600 leading-relaxed">{chunk.content}</p>
                                  </div>
                              ))}
                              {previewChunks.length === 0 && (
                                  <div className="text-center text-slate-400 py-10">暂无切片数据</div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default KnowledgePage;
