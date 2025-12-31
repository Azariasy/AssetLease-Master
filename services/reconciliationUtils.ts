
import { LedgerRow, BalanceRow } from '../types';
import * as XLSX from 'xlsx';

// Helper to parse amount strings like "-118,441.72", "1,234.00" or raw numbers
const parseAmount = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  // Remove quotes, commas, spaces, currency symbols
  const cleanVal = String(val).replace(/["',\s¥$]/g, '');
  const num = parseFloat(cleanVal);
  return isNaN(num) ? 0 : num;
};

// Helper: Fix Excel Serial Date (e.g., 45742 -> 2025-03-26)
const getJsDateFromExcel = (serial: number): Date | null => {
   // Excel base date: Dec 30, 1899
   const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
   return isNaN(date.getTime()) ? null : date;
};

const formatExcelDate = (val: any): string => {
  if (!val) return '';
  
  // Case 1: Excel Serial Number (e.g., 45742)
  if (typeof val === 'number' && val > 20000) {
    const date = getJsDateFromExcel(val);
    if (date) return date.toISOString().split('T')[0];
  }
  
  // Case 2: Already a string (e.g., "2025/03/26" or "26-Mar-2025")
  const strVal = String(val).trim();
  
  // Try to parse standard formats
  const dateObj = new Date(strVal);
  if (!isNaN(dateObj.getTime()) && strVal.length > 5) {
      // Ensure we format it as YYYY-MM-DD
      return dateObj.toISOString().split('T')[0];
  }

  // Fallback: return as is if parsing fails, but try to remove quotes
  return strVal.replace(/['"]/g, '');
};

const MONTH_MAP: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
    'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
    'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
};

// Helper: Format Period (Handle Excel Serial OR Full Date -> YYYY-MM)
const formatPeriod = (val: any): string => {
  if (!val) return '';

  // 1. Handle Excel Serial Number
  if (typeof val === 'number') {
    if (val > 20000) {
        const d = getJsDateFromExcel(val);
        if (d) {
             const y = d.getFullYear();
             const m = String(d.getMonth() + 1).padStart(2, '0');
             return `${y}-${m}`;
        }
    } else if (val > 200000 && val < 210000) {
        // Handle integer YYYYMM (e.g. 202405)
        const str = String(val);
        return `${str.substring(0,4)}-${str.substring(4,6)}`;
    }
  } 

  const strVal = String(val).trim().replace(/['"]/g, '');

  // 2. Handle "Mar-25" (MMM-YY) common in Oracle/SAP exports
  const mmmYyMatch = strVal.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (mmmYyMatch) {
      const mStr = mmmYyMatch[1]; // Mar
      const yStr = '20' + mmmYyMatch[2]; // 25 -> 2025
      const m = MONTH_MAP[mStr] || '01';
      return `${yStr}-${m}`;
  }

  // 3. Handle YYYY-MM standard
  if (/^\d{4}-\d{2}$/.test(strVal)) return strVal;
  
  // 4. Handle YYYYMM
  if (/^\d{6}$/.test(strVal)) {
     return `${strVal.substring(0,4)}-${strVal.substring(4,6)}`;
  }

  // 5. Handle YYYY.MM
  if (/^\d{4}\.\d{2}$/.test(strVal)) {
     return strVal.replace('.', '-');
  }

  // 6. Handle Chinese "2024年1月"
  if (strVal.includes('年')) {
     const y = strVal.split('年')[0];
     let m = strVal.split('年')[1].replace(/月|期/g, '');
     if (m.length === 1) m = '0' + m;
     return `${y}-${m}`;
  }

  // 7. Try parse as full date
  const d = new Date(strVal);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  return strVal;
};

// ==========================================
// Specialized Parser Logic for Company+Dept Segment
// ==========================================

const KNOWN_PREFIXES = ['391310', '012610'];

const extractCodesFromAccountString = (fullAccount: string): { deptCode: string, subjectCode: string } => {
    // Clean string: remove dots, spaces, dashes
    const clean = fullAccount.replace(/[\.\-\s]/g, '');
    
    // Check if it starts with known prefixes (Company Segment - 6 digits)
    const prefix = KNOWN_PREFIXES.find(p => clean.startsWith(p));
    
    if (prefix) {
        // Structure: Company (6) + Dept (6) + Subject (4+) + ...
        // Example: 391310 260003 6602...
        if (clean.length >= 16) { 
            const deptCode = clean.substring(6, 12);
            const subjectCode = clean.substring(12); 
            return { deptCode, subjectCode }; 
        }
    }
    
    // Fallback: Dot separated parsing
    if (fullAccount.includes('.')) {
        const parts = fullAccount.split('.');
        if (parts.length >= 3) {
            // Heuristic: Dept often starts with 26
            const potentialDept = parts.find(p => p.startsWith('26') && p.length === 6);
            if (potentialDept) {
                const deptIdx = parts.indexOf(potentialDept);
                if (deptIdx + 1 < parts.length) {
                    return { deptCode: potentialDept, subjectCode: parts[deptIdx+1] };
                }
            }
            // Simple fallback: 2nd segment is dept, 3rd is subject
            return { deptCode: parts[1], subjectCode: parts[2] };
        }
    }

    return { deptCode: '', subjectCode: '' };
};

// ==========================================
// Core: Generic Data Matrix Processor
// ==========================================
const processDataMatrix = (data: any[][]): LedgerRow[] => {
  let headerIndex = -1;
  const targetKeywords = ['凭证', '期间', '日期', '科目', '摘要', '借方', '贷方', '账户', '说明', '借项'];
  
  for(let i = 0; i < Math.min(data.length, 20); i++) {
    const row = data[i].map(cell => String(cell || '').trim());
    const matchCount = targetKeywords.filter(keyword => 
      row.some(cell => cell.includes(keyword))
    ).length;

    if (matchCount >= 2) { 
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    console.warn("Could not identify Ledger headers. Checked top 20 rows.");
    return [];
  }

  const headers = data[headerIndex].map(h => String(h || '').trim());
  const rows: LedgerRow[] = [];
  
  // Helper to find index by multiple keywords
  const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));

  // 1. Mappings
  let idxVoucher = findIdx(['凭证']); 
  let idxPeriod = findIdx(['GL期间', '会计期间', '期间']); 
  let idxDate = findIdx(['有效日期', '制单日期', '日期']); 
  let idxLineDesc = headers.findIndex(h => h === '行说明');
  let idxJournalSummary = headers.findIndex(h => h === '日记账摘要');
  let idxSummaryFallback = findIdx(['摘要', '说明']);

  // Subject Code
  let idxSubjectCode = headers.findIndex(h => 
      ['科目段', '科目编码', '科目代码'].includes(h) || 
      (h.includes('科目') && (h.includes('编') || h.includes('代') || h.includes('Code')) && !h.includes('组合') && !h.includes('串'))
  );

  // Subject Name
  let idxSubjectName = headers.findIndex(h => 
      ['科目段说明', '科目名称', '科目说明'].includes(h)
  );
  
  // Amounts
  let idxDebit = headers.findIndex(h => h === '原币借项' || h === '借方' || h === '借方金额');
  if (idxDebit === -1) idxDebit = findIdx(['借项', '借方', '本币借']);

  let idxCredit = headers.findIndex(h => h === '原币贷项' || h === '贷方' || h === '贷方金额');
  if (idxCredit === -1) idxCredit = findIdx(['贷项', '贷方', '本币贷']);
  
  // Counterparty
  let idxCpCode = headers.findIndex(h => h === '往来段' || h === '往来段编码');
  let idxCpName = headers.findIndex(h => h === '往来段说明' || h === '往来名称');
  let idxRef = headers.findIndex(h => h === '参考信息');
  if (idxCpCode === -1) idxCpCode = headers.findIndex(h => h.includes('往来') && (h.includes('编') || h.includes('Code') || h.includes('段')));
  if (idxCpName === -1) idxCpName = headers.findIndex(h => h.includes('往来') && (h.includes('名') || h.includes('说明')));

  // Department
  let idxDeptName = headers.findIndex(h => h === '成本中心说明' || h === '成本中心段说明');
  if (idxDeptName === -1) idxDeptName = headers.findIndex(h => (h.includes('部门') || h.includes('成本中心')) && !h.includes('段') && !h.includes('编'));

  let idxDeptCode = headers.findIndex(h => h === '部门段' || h === '成本中心段编码');
  if (idxDeptCode === -1) idxDeptCode = headers.findIndex(h => (h.includes('部门') || h.includes('成本中心')) && (h.includes('编') || h.includes('代') || h.includes('段')));

  // NEW: Project & Sub-account
  let idxProjCode = headers.findIndex(h => h === '项目段' || h === '项目段编码');
  let idxProjName = headers.findIndex(h => h === '项目说明' || h === '项目描述' || h === '项目段说明');
  let idxSubCode = headers.findIndex(h => h === '子目段' || h === '子目段编码');
  let idxSubName = headers.findIndex(h => h === '子目段说明' || h === '子目名称');

  // Fallback: Full Account String
  const idxFullAccount = headers.findIndex(h => h === '账户' || h === '科目组合' || h === '科目串'); 

  for (let i = headerIndex + 1; i < data.length; i++) {
    const cells = data[i];
    if (!cells || cells.length === 0) continue;
    
    // Validation
    const hasContent = (idxVoucher > -1 && cells[idxVoucher]) || 
                       (idxPeriod > -1 && cells[idxPeriod]);
                       
    if (!hasContent) continue;

    // Amounts
    let debit = 0;
    let credit = 0;
    if (idxDebit > -1) debit = parseAmount(cells[idxDebit]);
    if (idxCredit > -1) credit = parseAmount(cells[idxCredit]);

    // Summary Logic
    let summary = '';
    if (idxLineDesc > -1 && cells[idxLineDesc]) summary = String(cells[idxLineDesc]).trim();
    if (!summary && idxJournalSummary > -1 && cells[idxJournalSummary]) summary = String(cells[idxJournalSummary]).trim();
    if (!summary && idxSummaryFallback > -1 && cells[idxSummaryFallback]) summary = String(cells[idxSummaryFallback]).trim();
    summary = summary.replace(/^"|"$/g, '').trim();

    // Counterparty Logic
    let counterparty = '';
    let counterpartyCode = '';
    let counterpartyName = '';

    const cpCodeVal = idxCpCode > -1 ? String(cells[idxCpCode] || '').trim() : '';
    const cpNameVal = idxCpName > -1 ? String(cells[idxCpName] || '').trim() : '';
    const refVal = idxRef > -1 ? String(cells[idxRef] || '').trim() : '';

    const isDefault = !cpCodeVal || cpCodeVal === '0' || cpCodeVal === '缺省' || !cpNameVal || cpNameVal === '缺省';
    
    if (isDefault && refVal) {
        counterparty = refVal;
        counterpartyName = refVal; // Fallback name
    } else {
        counterparty = `${cpCodeVal} ${cpNameVal}`.trim();
        counterpartyCode = cpCodeVal;
        counterpartyName = cpNameVal;
    }

    const formattedDate = idxDate > -1 ? formatExcelDate(cells[idxDate]) : '';
    const formattedPeriod = idxPeriod > -1 ? formatPeriod(cells[idxPeriod]) : '';

    // Department Logic
    let departmentCode = '';
    let departmentName = '';
    
    if (idxDeptCode > -1) {
        const rawDept = String(cells[idxDeptCode] || '').replace(/[\.\s]/g, '');
        if (rawDept.length >= 12 && KNOWN_PREFIXES.some(p => rawDept.startsWith(p))) {
             departmentCode = rawDept.substring(6, 12);
        } else {
             departmentCode = rawDept;
        }
    }
    if (idxDeptName > -1) {
        departmentName = String(cells[idxDeptName] || '').trim();
    }

    // NEW: Project & Sub-account Extraction
    const projectCode = idxProjCode > -1 ? String(cells[idxProjCode] || '').trim() : '';
    const projectName = idxProjName > -1 ? String(cells[idxProjName] || '').trim() : '';
    const subCode = idxSubCode > -1 ? String(cells[idxSubCode] || '').trim() : '';
    const subName = idxSubName > -1 ? String(cells[idxSubName] || '').trim() : '';

    // Subject Code Logic
    let subjectCode = idxSubjectCode > -1 ? String(cells[idxSubjectCode] || '').trim() : '';
    const looksLikeFullAccount = subjectCode.length > 20 && subjectCode.includes('.');
    
    if ((!subjectCode || looksLikeFullAccount) && idxFullAccount > -1) {
        const fullAcc = String(cells[idxFullAccount] || '');
        const extracted = extractCodesFromAccountString(fullAcc);
        if (!departmentCode) departmentCode = extracted.deptCode;
        if (!subjectCode || looksLikeFullAccount) subjectCode = extracted.subjectCode;
    }

    if (subjectCode) subjectCode = subjectCode.replace(/[\.\s]/g, '');

    rows.push({
      id: `imp-${i}-${Date.now()}`,
      voucherNo: idxVoucher > -1 ? String(cells[idxVoucher] || '') : '',
      period: formattedPeriod,
      date: formattedDate,
      summary: summary,
      subjectCode: subjectCode,
      subjectName: idxSubjectName > -1 ? String(cells[idxSubjectName] || '').trim() : '',
      debitAmount: debit,
      creditAmount: credit,
      counterparty: counterparty,
      counterpartyCode: counterpartyCode === '0' || counterpartyCode === '缺省' ? '' : counterpartyCode,
      counterpartyName: counterpartyName === '缺省' ? '' : counterpartyName,
      rawReference: refVal,
      department: departmentCode, 
      departmentName: departmentName,
      projectCode: projectCode === '0' || projectCode === '缺省' ? '' : projectCode,
      projectName: projectName === '缺省' ? '' : projectName,
      subAccountCode: subCode === '0' || subCode === '缺省' ? '' : subCode,
      subAccountName: subName === '缺省' ? '' : subName,
    });
  }

  return rows;
};

// ==========================================
// NEW: Balance Sheet Processor
// ==========================================
const processBalanceMatrix = (data: any[][]): BalanceRow[] => {
    let headerIndex = -1;
    const targetKeywords = ['科目', '期初', '期末', '余额', '借方', '贷方', '本期', '名称'];
    
    for(let i = 0; i < Math.min(data.length, 20); i++) {
      const row = data[i].map(cell => String(cell || '').trim());
      const matchCount = targetKeywords.filter(keyword => 
        row.some(cell => cell.includes(keyword))
      ).length;

      if (matchCount >= 2) {
        headerIndex = i;
        break;
      }
    }
  
    if (headerIndex === -1) {
      console.error("Could not identify Balance Sheet headers.");
      return [];
    }
  
    const headers = data[headerIndex].map(h => String(h || '').trim());
    const rows: BalanceRow[] = [];
    const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));
  
    // 2. Identify Column Indices
    let idxPeriod = findIdx(['期间']);
    
    let idxSubjectCode = headers.findIndex(h => ['科目编码', '科目代码', '科目段编码', '科目段'].includes(h));
    if (idxSubjectCode === -1) idxSubjectCode = headers.findIndex(h => h.includes('科目') && (h.includes('编') || h.includes('代')) && !h.includes('组合'));

    let idxSubjectName = headers.findIndex(h => ['科目名称', '科目说明', '科目段说明'].includes(h) || (h.includes('科目') && (h.includes('名') || h.includes('说'))));
    
    let idxElement = findIdx(['会计要素', '科目类别']);
    
    // Cost Center
    let idxCostCenter = headers.findIndex(h => h === '成本中心说明' || h === '成本中心段说明');
    if (idxCostCenter === -1) idxCostCenter = headers.findIndex(h => h.includes('成本中心') || (h.includes('部门') && !h.includes('编')));
    
    let idxCostCenterCode = headers.findIndex(h => h === '成本中心段编码' || h === '部门段');
    if (idxCostCenterCode === -1) idxCostCenterCode = headers.findIndex(h => (h.includes('成本中心') || h.includes('部门')) && (h.includes('编') || h.includes('Code')));
    
    const idxFullAccount = headers.findIndex(h => h === '账户' || h === '科目组合' || h === '科目串'); 

    // Counterparty
    let idxCounterpartyCode = headers.findIndex(h => h === '往来段编码');
    let idxCounterparty = headers.findIndex(h => h === '往来段说明' || h === '客商名称'); 
    if (idxCounterparty === -1) idxCounterparty = headers.findIndex(h => (h.includes('往来') || h.includes('客商')) && !h.includes('编码') && !h.includes('Code'));
    if (idxCounterpartyCode === -1) idxCounterpartyCode = headers.findIndex(h => (h.includes('往来') || h.includes('客商')) && (h.includes('编码') || h.includes('Code')));

    // Project & Sub-account
    let idxProjCode = headers.findIndex(h => h === '项目段编码' || h === '项目段');
    let idxProjName = headers.findIndex(h => h === '项目段说明' || h === '项目说明');
    let idxSubCode = headers.findIndex(h => h === '子目段编码' || h === '子目段');
    let idxSubName = headers.findIndex(h => h === '子目段说明' || h === '子目说明');

    // Amounts
    let idxOpening = findIdx(['期初']);
    let idxDebit = findIdx(['借方', '借项', '本期借']);
    let idxCredit = findIdx(['贷方', '贷项', '本期贷']);
    let idxClosing = findIdx(['期末']);

    let idxYtdDebit = headers.findIndex(h => h.includes('借') && (h.includes('累计') || h.includes('本年')));
    let idxYtdCredit = headers.findIndex(h => h.includes('贷') && (h.includes('累计') || h.includes('本年')));
    let idxLyDebit = headers.findIndex(h => h.includes('上年') && h.includes('借'));
    let idxLyCredit = headers.findIndex(h => h.includes('上年') && h.includes('贷'));

    // NEW: Last Year Closing Balance
    let idxLyClosing = headers.findIndex(h => 
        (h.includes('上年') || h.includes('去年') || h.includes('同期')) && 
        (h.includes('期末') || h.includes('余额')) &&
        !h.includes('借') && !h.includes('贷')
    );
    
    // 3. Process Rows
    for (let i = headerIndex + 1; i < data.length; i++) {
        const cells = data[i];
        if (!cells || cells.length === 0) continue;

        let period = idxPeriod > -1 ? formatPeriod(cells[idxPeriod]) : '';
        let code = idxSubjectCode > -1 ? String(cells[idxSubjectCode] || '').trim() : '';
        const name = idxSubjectName > -1 ? String(cells[idxSubjectName] || '').trim() : '';
        const element = idxElement > -1 ? String(cells[idxElement] || '') : '未分类';
        
        let deptCode = '';
        let deptName = idxCostCenter > -1 ? String(cells[idxCostCenter] || '').trim() : '';

        if (idxCostCenterCode > -1) {
            const rawDept = String(cells[idxCostCenterCode] || '').replace(/[\.\s]/g, '');
            if (rawDept.length >= 12 && KNOWN_PREFIXES.some(p => rawDept.startsWith(p))) {
                 deptCode = rawDept.substring(6, 12);
            } else {
                 deptCode = rawDept;
            }
        }

        if (idxFullAccount > -1) {
             const fullAcc = String(cells[idxFullAccount] || '');
             const extracted = extractCodesFromAccountString(fullAcc);
             if (!code) code = extracted.subjectCode; 
             if (!deptCode) deptCode = extracted.deptCode;
        }

        if (code) {
             code = code.replace(/[\.\s]/g, '');
        } else {
             continue; 
        }

        const cpCode = idxCounterpartyCode > -1 ? String(cells[idxCounterpartyCode] || '').trim() : '';
        const cpName = idxCounterparty > -1 ? String(cells[idxCounterparty] || '').trim() : '';
        const projCode = idxProjCode > -1 ? String(cells[idxProjCode] || '').trim() : '';
        const projName = idxProjName > -1 ? String(cells[idxProjName] || '').trim() : '';
        const subCode = idxSubCode > -1 ? String(cells[idxSubCode] || '').trim() : '';
        const subName = idxSubName > -1 ? String(cells[idxSubName] || '').trim() : '';

        let fullCounterparty = '';
        if (cpName && cpName !== '缺省') fullCounterparty = cpName;
        else if (cpCode && cpCode !== '0') fullCounterparty = cpCode;

        rows.push({
            id: `bal-${i}-${Date.now()}`,
            period: period,
            subjectCode: code,
            subjectName: name,
            accountElement: element,
            
            costCenter: deptName || deptCode, 
            costCenterCode: deptCode,
            costCenterName: deptName === '缺省' ? '' : deptName,

            counterparty: fullCounterparty,
            counterpartyCode: cpCode === '0' || cpCode === '缺省' ? '' : cpCode,
            counterpartyName: cpName === '缺省' ? '' : cpName,

            projectCode: projCode === '0' || projCode === '缺省' ? '' : projCode,
            projectName: projName === '缺省' ? '' : projName,

            subAccountCode: subCode === '0' || subCode === '缺省' ? '' : subCode,
            subAccountName: subName === '缺省' ? '' : subName,
            
            openingBalance: idxOpening > -1 ? parseAmount(cells[idxOpening]) : 0,
            debitPeriod: idxDebit > -1 ? parseAmount(cells[idxDebit]) : 0,
            creditPeriod: idxCredit > -1 ? parseAmount(cells[idxCredit]) : 0,
            closingBalance: idxClosing > -1 ? parseAmount(cells[idxClosing]) : 0,

            ytdDebit: idxYtdDebit > -1 ? parseAmount(cells[idxYtdDebit]) : 0,
            ytdCredit: idxYtdCredit > -1 ? parseAmount(cells[idxYtdCredit]) : 0,
            lastYearDebit: idxLyDebit > -1 ? parseAmount(cells[idxLyDebit]) : 0,
            lastYearCredit: idxLyCredit > -1 ? parseAmount(cells[idxLyCredit]) : 0,
            
            lastYearClosingBalance: idxLyClosing > -1 ? parseAmount(cells[idxLyClosing]) : 0,
        });
    }

    return rows;
}


const parseCSVLine = (line: string): string[] => {
  const result = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; } 
      else { inQuote = !inQuote; }
    } else if (char === ',' && !inQuote) {
      result.push(current.trim());
      current = '';
    } else { current += char; }
  }
  result.push(current.trim());
  return result;
};

export const parseCSVData = (fileContent: string): LedgerRow[] => {
  const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');
  const matrix = lines.map(line => parseCSVLine(line));
  return processDataMatrix(matrix);
};

export const parseBalanceCSV = (fileContent: string): BalanceRow[] => {
    const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');
    const matrix = lines.map(line => parseCSVLine(line));
    return processBalanceMatrix(matrix);
};

// ============================================================================
// WEB WORKER IMPLEMENTATION for Excel Parsing
// ============================================================================

// Worker Source Code as a String
const workerScript = `
importScripts("https://cdn.sheetjs.com/xlsx-0.18.5/package/dist/xlsx.full.min.js");

self.onmessage = function(e) {
  try {
    const { data, type } = e.data;
    const workbook = XLSX.read(data, { type: 'binary' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // Convert to matrix (array of arrays)
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Return raw matrix to main thread for processing
    self.postMessage({ success: true, matrix: matrix });
  } catch (err) {
    self.postMessage({ success: false, error: err.message });
  }
};
`;

const createWorker = () => {
  const blob = new Blob([workerScript], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

export const parseExcelData = async (file: File): Promise<LedgerRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const data = e.target?.result;
      
      // Try using Worker
      try {
          const worker = createWorker();
          
          worker.onmessage = (event) => {
              const { success, matrix, error } = event.data;
              if (success) {
                  // Process the matrix on main thread (fast operation)
                  const result = processDataMatrix(matrix);
                  resolve(result);
              } else {
                  console.warn("Worker Parsing Failed, falling back to main thread", error);
                  // Fallback to main thread
                  try {
                      const workbook = XLSX.read(data, { type: 'binary' });
                      const sheetName = workbook.SheetNames[0];
                      const sheet = workbook.Sheets[sheetName];
                      const mat = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
                      resolve(processDataMatrix(mat));
                  } catch (fallbackErr) {
                      reject(fallbackErr);
                  }
              }
              worker.terminate();
          };

          worker.onerror = (err) => {
              console.warn("Worker Error", err);
              worker.terminate();
              // Fallback logic duplicated for safety
              try {
                  const workbook = XLSX.read(data, { type: 'binary' });
                  const sheetName = workbook.SheetNames[0];
                  const sheet = workbook.Sheets[sheetName];
                  const mat = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
                  resolve(processDataMatrix(mat));
              } catch (fallbackErr) {
                  reject(fallbackErr);
              }
          };

          // Send data to worker
          worker.postMessage({ data, type: 'ledger' });

      } catch (err) {
           console.error("Worker creation failed", err);
           reject(err);
      }
    };
    
    reader.onerror = (ex) => reject(ex);
    reader.readAsBinaryString(file);
  });
};

export const parseExcelBalance = async (file: File): Promise<BalanceRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result;
        
        // Use Worker Logic (Reusing same worker logic, different processor)
        try {
            const worker = createWorker();
            worker.onmessage = (event) => {
                const { success, matrix, error } = event.data;
                if (success) {
                    const result = processBalanceMatrix(matrix);
                    resolve(result);
                } else {
                    reject(new Error(error));
                }
                worker.terminate();
            };
            worker.postMessage({ data, type: 'balance' });
        } catch (err) {
             // Main thread fallback
             try {
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
                const result = processBalanceMatrix(matrix);
                resolve(result);
             } catch (e) { reject(e); }
        }
      };
      reader.onerror = (ex) => reject(ex);
      reader.readAsBinaryString(file);
    });
  };

export const parseBalanceImport = (fileContent: string): BalanceRow[] => {
    return parseBalanceCSV(fileContent);
}
