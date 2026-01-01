
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

// Handle ESM import structure (sometimes exports are under 'default' depending on bundler/cdn)
const pdf = (pdfjsLib as any).default || pdfjsLib;

// 解决 ESM 环境下 worker 配置问题
// Ensure we use the correct worker version matching the library
if (typeof window !== 'undefined' && 'Worker' in window) {
  // Use specific version from esm.sh to match imports in index.html
  if (pdf && pdf.GlobalWorkerOptions) {
      // Use CDNJS for the worker script as it provides a classic script format compatible with standard Worker loading
      // esm.sh returns an ES module which causes "importScripts" or syntax errors in standard worker contexts
      pdf.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

export const extractTextFromFile = async (file: File): Promise<string> => {
  const fileType = file.name.split('.').pop()?.toLowerCase();

  switch (fileType) {
    case 'txt':
    case 'md':
    case 'json':
    case 'csv':
      return await readTextFile(file);
      
    case 'docx':
    case 'doc':
      return await readDocxFile(file);
      
    case 'pdf':
      return await readPdfFile(file);
      
    default:
      throw new Error(`不支持的文件格式: .${fileType}。目前支持 .txt, .md, .doc, .docx, .pdf`);
  }
};

// 1. Text/Markdown Parser
const readTextFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = (e) => reject(new Error("文件读取失败"));
    reader.readAsText(file);
  });
};

// 2. Word (DOCX) Parser using Mammoth
const readDocxFile = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const result = await mammoth.extractRawText({ arrayBuffer });
        resolve(result.value); 
      } catch (err) {
        console.error(err);
        const isDoc = file.name.toLowerCase().endsWith('.doc');
        reject(new Error(isDoc 
            ? "解析 .doc 文件失败。系统仅支持标准 .docx 格式，如果是旧版 Word 文档，请先另存为 .docx 格式后重试。" 
            : "Word 文档解析失败，请确保文件未加密且格式正确"));
      }
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
};

// 3. PDF Parser using PDF.js
const readPdfFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            
            // Check if getDocument is available
            if (!pdf || !pdf.getDocument) {
                throw new Error("PDF 解析库加载失败");
            }

            // Standard PDF.js document loading
            const loadingTask = pdf.getDocument({ data: arrayBuffer });
            const pdfDoc = await loadingTask.promise;
            
            let fullText = '';
            const totalPages = pdfDoc.numPages;

            // Loop through each page
            for (let i = 1; i <= totalPages; i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                // Join text items with space to preserve basic layout flow
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += `[Page ${i}]\n${pageText}\n\n`;
            }
            
            if (fullText.trim().length === 0) {
               throw new Error("PDF 似乎是纯图片扫描件，当前版本暂不支持 OCR 识别。");
            }

            resolve(fullText);
        } catch (err: any) {
            console.error(err);
            reject(new Error(err.message || "PDF 解析失败"));
        }
      };
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsArrayBuffer(file);
    });
};
