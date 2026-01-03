
// @ts-ignore
import mammoth from 'mammoth';
// @ts-ignore
import * as pdfjsProxy from 'pdfjs-dist';

// Handle ESM/CJS interop for PDF.js
const pdfjsLib = (pdfjsProxy as any).default || pdfjsProxy;

// Set worker source for PDF.js using a stable CDN (cdnjs) that serves the classic script format
// esm.sh serves modules by default which causes importScripts to fail in the worker
// CRITICAL: Version MUST match package.json or importmap exactly (3.11.174)
if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/**
 * 现代文档解析器 (Modern File Parser) - Robust Version
 */

export interface ParsedFile {
    content: string; // 文本内容 或 Base64 字符串
    mimeType: string;
    isBinary: boolean;
}

// 安全的 Chunk Size (32KB)
const CHUNK_SIZE = 0x8000; 

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    // @ts-ignore
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
};

// Local PDF Extraction
const extractPdfText = async (file: File): Promise<string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        let fullText = '';
        // Limit pages to avoid browser hanging on massive docs during local parse
        const maxPages = Math.min(pdf.numPages, 50); 
        
        for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n\n';
        }
        return fullText;
    } catch (e: any) {
        console.warn("Local PDF parse failed:", e);
        // Fallback to binary handling in readFileForAI
        throw new Error(`PDF 解析失败: ${e.message}`);
    }
};

export const readFileForAI = async (file: File): Promise<ParsedFile> => {
  const fileType = file.name.split('.').pop()?.toLowerCase();
  
  // 1. 本地直接读取的纯文本格式
  if (['txt', 'md', 'json', 'csv'].includes(fileType || '')) {
      try {
          const text = await readTextFile(file);
          return { content: text, mimeType: 'text/plain', isBinary: false };
      } catch (e) {
          throw new Error("文本读取失败，文件可能已损坏。");
      }
  }

  // 2. DOCX 处理 (Mammoth)
  if (fileType === 'docx') {
      try {
          if (file.size > 50 * 1024 * 1024) throw new Error("文件过大");
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          if (!result.value.trim()) throw new Error("内容为空");
          return { content: result.value, mimeType: 'text/plain', isBinary: false };
      } catch (e: any) {
          console.warn("Mammoth parse failed:", e);
          // If Mammoth fails, treat as binary? No, DOCX structure is complex. Just fail.
          throw new Error(`Word 解析失败: ${e.message}`);
      }
  }

  // 3. PDF 处理 (PDF.js Local Extraction)
  // 优先尝试本地提取文本，因为这样可以节省大量 Token 且不受图片大小限制。
  // 如果本地提取失败（例如是扫描版 PDF），则抛出错误并在 catch 中降级为二进制图片处理。
  if (fileType === 'pdf') {
     try {
         const text = await extractPdfText(file);
         // Ensure we got something useful (not just empty pages)
         if (text.trim().length > 50) {
             return { content: text, mimeType: 'text/plain', isBinary: false };
         }
         console.log("PDF text extraction yielded minimal content, falling back to AI OCR.");
     } catch (e) {
         console.warn("Local PDF extraction failed, falling back to AI OCR mode:", e);
     }
  }

  // 4. 二进制文件 (PDF fallback, Images, Excel)
  let mimeType = '';
  switch (fileType) {
      case 'pdf': mimeType = 'application/pdf'; break;
      case 'xlsx': mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; break;
      case 'xls': mimeType = 'application/vnd.ms-excel'; break;
      case 'csv': mimeType = 'text/csv'; break;
      default: 
          if (file.type.startsWith('image/')) {
              mimeType = file.type;
          } else {
              // Try text fallback
              try {
                  const text = await readTextFile(file);
                  return { content: text, mimeType: 'text/plain', isBinary: false };
              } catch {
                  throw new Error(`不支持的文件格式: .${fileType}`);
              }
          }
  }

  try {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      return {
          content: base64,
          mimeType: mimeType,
          isBinary: true
      };
  } catch (e: any) {
      throw new Error(`文件读取失败: ${e.message}`);
  }
};

const readTextFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = (e) => reject(new Error("文件读取失败"));
    reader.readAsText(file);
  });
};

export const extractTextFromFile = async (file: File, onProgress?: (percent: number, msg: string) => void): Promise<string> => {
    throw new Error("Legacy parser deprecated.");
};
