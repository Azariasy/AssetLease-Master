import { LedgerRow, BalanceRow } from '../types';
import * as XLSX from 'xlsx';

// Helper to parse amount strings like "-118,441.72", "1,234.00" or raw numbers
const parseAmount = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleanVal = String(val).replace(/["',\s¥$]/g, '');
  const num = parseFloat(cleanVal);
  return isNaN(num) ? 0 : num;
};

// Helper: Fix Excel Serial Date (e.g., 45742 -> 2025-03-26)
const getJsDateFromExcel = (serial: number): Date | null => {
   const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
   return isNaN(date.getTime()) ? null : date;
};

const formatExcelDate = (val: any): string => {
  if (!val) return '';
  if (typeof val === 'number' && val > 20000) {
    const date = getJsDateFromExcel(val);
    if (date) return date.toISOString().split('T')[0];
  }
  const strVal = String(val).trim();
  const dateObj = new Date(strVal);
  if (!isNaN(dateObj.getTime()) && strVal.length > 5) {
      return dateObj.toISOString().split('T')[0];
  }
  return strVal.replace(/['"]/g, '');
};

const MONTH_MAP: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
    'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
    'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
};

const formatPeriod = (val: any): string => {
  if (!val) return '';
  if (typeof val === 'number') {
    if (val > 20000) {
        const d = getJsDateFromExcel(val);
        if (d) {
             const y = d.getFullYear();
             const m = String(d.getMonth() + 1).padStart(2, '0');
             return `${y}-${m}`;
        }
    } else if (val > 200000 && val < 210000) {
        const str = String(val);
        return `${str.substring(0,4)}-${str.substring(4,6)}`;
    }
  } 
  const strVal = String(val).trim().replace(/['"]/g, '');
  const mmmYyMatch = strVal.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (mmmYyMatch) {
      const mStr = mmmYyMatch[1]; 
      const yStr = '20' + mmmYyMatch[2]; 
      const m = MONTH_MAP[mStr] || '01';
      return `${yStr}-${m}`;
  }
  if (/^\d{4}-\d{2}$/.test(strVal)) return strVal;
  if (/^\d{6}$/.test(strVal)) return `${strVal.substring(0,4)}-${strVal.substring(4,6)}`;
  if (/^\d{4}\.\d{2}$/.test(strVal)) return strVal.replace('.', '-');
  if (strVal.includes('年')) {
     const y = strVal.split('年')[0];
     let m = strVal.split('年')[1].replace(/月|期/g, '');
     if (m.length === 1) m = '0' + m;
     return `${y}-${m}`;
  }
  const d = new Date(strVal);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  return strVal;
};

const KNOWN_PREFIXES = ['391310', '012610'];

const extractCodesFromAccountString = (fullAccount: string): { deptCode: string, subjectCode: string } => {
    const clean = fullAccount.replace(/[\.\-\s]/g, '');
    const prefix = KNOWN_PREFIXES.find(p => clean.startsWith(p));
    if (prefix) {
        if (clean.length >= 16) { 
            const deptCode = clean.substring(6, 12);
            const subjectCode = clean.substring(12); 
            return { deptCode, subjectCode }; 
        }
    }
    if (fullAccount.includes('.')) {
        const parts = fullAccount.split('.');
        if (parts.length >= 3) {
            const potentialDept = parts.find(p => p.startsWith('26') && p.length === 6);
            if (potentialDept) {
                const deptIdx = parts.indexOf(potentialDept);
                if (deptIdx + 1 < parts.length) {
                    return { deptCode: potentialDept, subjectCode: parts[deptIdx+1] };
                }
            }
            return { deptCode: parts[1], subjectCode: parts[2] };
        }
    }
    return { deptCode: '', subjectCode: '' };
};

// ==========================================
// Core: Generic Data Matrix Processor
// ==========================================
const processDataMatrix = (data: any[][], expectedPrefix?: string): LedgerRow[] => {
  if (!data || data.length === 0) return [];
  
  let headerIndex = -1;
  const targetKeywords = ['凭证', '期间', '日期', '科目', '摘要', '借方', '贷方', '账户', '说明', '借项'];
  
  // Scan deeper for header (up to 100 rows) in case of complex reports
  for(let i = 0; i < Math.min(data.length, 100); i++) {
    const row = data[i];
    if (!Array.isArray(row)) continue; 
    
    const rowStr = row.map(cell => String(cell || '').trim());
    const matchCount = targetKeywords.filter(keyword => 
      rowStr.some(cell => cell.includes(keyword))
    ).length;

    if (matchCount >= 2) { 
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    console.warn("Could not identify Ledger headers. Checked top 100 rows.");
    return [];
  }

  // Ensure header row exists
  if (!data[headerIndex]) return [];
  const headers = data[headerIndex].map(h => String(h || '').trim());
  const rows: LedgerRow[] = [];
  const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));

  // ... (Mapping logic same as previous version)
  let idxVoucher = findIdx(['凭证']); 
  let idxPeriod = findIdx(['GL期间', '会计期间', '期间']); 
  let idxDate = findIdx(['有效日期', '制单日期', '日期']); 
  let idxLineDesc = headers.findIndex(h => h === '行说明');
  let idxJournalSummary = headers.findIndex(h => h === '日记账摘要');
  let idxSummaryFallback = findIdx(['摘要', '说明']);
  let idxSubjectCode = headers.findIndex(h => ['科目段', '科目编码', '科目代码'].includes(h) || (h.includes('科目') && (h.includes('编') || h.includes('代') || h.includes('Code')) && !h.includes('组合') && !h.includes('串')));
  let idxSubjectName = headers.findIndex(h => ['科目段说明', '科目名称', '科目说明'].includes(h));
  let idxDebit = headers.findIndex(h => h === '原币借项' || h === '借方' || h === '借方金额');
  if (idxDebit === -1) idxDebit = findIdx(['借项', '借方', '本币借']);
  let idxCredit = headers.findIndex(h => h === '原币贷项' || h === '贷方' || h === '贷方金额');
  if (idxCredit === -1) idxCredit = findIdx(['贷项', '贷方', '本币贷']);
  let idxCpCode = headers.findIndex(h => h === '往来段' || h === '往来段编码');
  let idxCpName = headers.findIndex(h => h === '往来段说明' || h === '往来名称');
  let idxRef = headers.findIndex(h => h === '参考信息');
  if (idxCpCode === -1) idxCpCode = headers.findIndex(h => h.includes('往来') && (h.includes('编') || h.includes('Code') || h.includes('段')));
  if (idxCpName === -1) idxCpName = headers.findIndex(h => h.includes('往来') && (h.includes('名') || h.includes('说明')));
  let idxDeptName = headers.findIndex(h => h === '成本中心说明' || h === '成本中心段说明');
  if (idxDeptName === -1) idxDeptName = headers.findIndex(h => (h.includes('部门') || h.includes('成本中心')) && !h.includes('段') && !h.includes('编'));
  let idxDeptCode = headers.findIndex(h => h === '部门段' || h === '成本中心段编码');
  if (idxDeptCode === -1) idxDeptCode = headers.findIndex(h => (h.includes('部门') || h.includes('成本中心')) && (h.includes('编') || h.includes('代') || h.includes('段')));
  let idxProjCode = headers.findIndex(h => h === '项目段' || h === '项目段编码');
  let idxProjName = headers.findIndex(h => h === '项目说明' || h === '项目描述' || h === '项目段说明');
  let idxSubCode = headers.findIndex(h => h === '子目段' || h === '子目段编码');
  let idxSubName = headers.findIndex(h => h === '子目段说明' || h === '子目名称');
  const idxFullAccount = headers.findIndex(h => h === '账户' || h === '科目组合' || h === '科目串'); 

  for (let i = headerIndex + 1; i < data.length; i++) {
    const cells = data[i];
    if (!cells || cells.length === 0) continue;
    
    // ... (Row processing logic same as previous version)
    const hasContent = (idxVoucher > -1 && cells[idxVoucher]) || (idxPeriod > -1 && cells[idxPeriod]);
    if (!hasContent) continue;

    let debit = 0;
    let credit = 0;
    if (idxDebit > -1) debit = parseAmount(cells[idxDebit]);
    if (idxCredit > -1) credit = parseAmount(cells[idxCredit]);

    let summary = '';
    if (idxLineDesc > -1 && cells[idxLineDesc]) summary = String(cells[idxLineDesc]).trim();
    if (!summary && idxJournalSummary > -1 && cells[idxJournalSummary]) summary = String(cells[idxJournalSummary]).trim();
    if (!summary && idxSummaryFallback > -1 && cells[idxSummaryFallback]) summary = String(cells[idxSummaryFallback]).trim();
    summary = summary.replace(/^"|"$/g, '').trim();

    let counterparty = '';
    let counterpartyCode = '';
    let counterpartyName = '';
    const cpCodeVal = idxCpCode > -1 ? String(cells[idxCpCode] || '').trim() : '';
    const cpNameVal = idxCpName > -1 ? String(cells[idxCpName] || '').trim() : '';
    const refVal = idxRef > -1 ? String(cells[idxRef] || '').trim() : '';
    const isDefault = !cpCodeVal || cpCodeVal === '0' || cpCodeVal === '缺省' || !cpNameVal || cpNameVal === '缺省';
    if (isDefault && refVal) {
        counterparty = refVal;
        counterpartyName = refVal;
    } else {
        counterparty = `${cpCodeVal} ${cpNameVal}`.trim();
        counterpartyCode = cpCodeVal;
        counterpartyName = cpNameVal;
    }

    const formattedDate = idxDate > -1 ? formatExcelDate(cells[idxDate]) : '';
    const formattedPeriod = idxPeriod > -1 ? formatPeriod(cells[idxPeriod]) : '';

    let departmentCode = '';
    let departmentName = '';
    if (idxDeptCode > -1) {
        const rawDept = String(cells[idxDeptCode] || '').replace(/[\.\s]/g, '');
        if (expectedPrefix && rawDept.length >= 6) {
            const detected = KNOWN_PREFIXES.find(p => rawDept.startsWith(p));
            // Only throw mismatch if we are very sure it's a segment code (starts with 39 or 01)
            if (detected && detected !== expectedPrefix) {
                // Soft warning or error? Let's be strict for data safety.
                throw new Error(`ENTITY_MISMATCH:${detected}`);
            }
        }
        if (rawDept.length >= 12 && KNOWN_PREFIXES.some(p => rawDept.startsWith(p))) {
             departmentCode = rawDept.substring(6, 12);
        } else {
             departmentCode = rawDept;
        }
    }
    if (idxDeptName > -1) departmentName = String(cells[idxDeptName] || '').trim();

    const projectCode = idxProjCode > -1 ? String(cells[idxProjCode] || '').trim() : '';
    const projectName = idxProjName > -1 ? String(cells[idxProjName] || '').trim() : '';
    const subCode = idxSubCode > -1 ? String(cells[idxSubCode] || '').trim() : '';
    const subName = idxSubName > -1 ? String(cells[idxSubName] || '').trim() : '';

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
const processBalanceMatrix = (data: any[][], expectedPrefix?: string): BalanceRow[] => {
    if (!data || data.length === 0) return [];
    
    let headerIndex = -1;
    const targetKeywords = ['科目', '期初', '期末', '余额', '借方', '贷方', '本期', '名称'];
    for(let i = 0; i < Math.min(data.length, 100); i++) {
      const row = data[i];
      if (!Array.isArray(row)) continue; // Safe iteration for sparse arrays

      const rowStr = row.map(cell => String(cell || '').trim());
      const matchCount = targetKeywords.filter(keyword => rowStr.some(cell => cell.includes(keyword))).length;
      if (matchCount >= 2) {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex === -1) {
      console.error("Could not identify Balance Sheet headers.");
      return [];
    }
  
    // Ensure header row exists
    if (!data[headerIndex]) return [];
    const headers = data[headerIndex].map(h => String(h || '').trim());
    const rows: BalanceRow[] = [];
    const findIdx = (keywords: string[]) => headers.findIndex(h => keywords.some(k => h.includes(k)));
  
    // ... (Indices mapping same as previous)
    let idxPeriod = findIdx(['期间']);
    let idxSubjectCode = headers.findIndex(h => ['科目编码', '科目代码', '科目段编码', '科目段'].includes(h));
    if (idxSubjectCode === -1) idxSubjectCode = headers.findIndex(h => h.includes('科目') && (h.includes('编') || h.includes('代')) && !h.includes('组合'));
    let idxSubjectName = headers.findIndex(h => ['科目名称', '科目说明', '科目段说明'].includes(h) || (h.includes('科目') && (h.includes('名') || h.includes('说'))));
    let idxElement = findIdx(['会计要素', '科目类别']);
    let idxCostCenter = headers.findIndex(h => h === '成本中心说明' || h === '成本中心段说明');
    if (idxCostCenter === -1) idxCostCenter = headers.findIndex(h => h.includes('成本中心') || (h.includes('部门') && !h.includes('段') && !h.includes('编')));
    let idxCostCenterCode = headers.findIndex(h => h === '成本中心段编码' || h === '部门段');
    if (idxCostCenterCode === -1) idxCostCenterCode = headers.findIndex(h => (h.includes('成本中心') || h.includes('部门')) && (h.includes('编') || h.includes('Code')));
    const idxFullAccount = headers.findIndex(h => h === '账户' || h === '科目组合' || h === '科目串'); 
    let idxCounterpartyCode = headers.findIndex(h => h === '往来段编码');
    let idxCounterparty = headers.findIndex(h => h === '往来段说明' || h === '客商名称'); 
    if (idxCounterparty === -1) idxCounterparty = headers.findIndex(h => (h.includes('往来') || h.includes('客商')) && !h.includes('编码') && !h.includes('Code'));
    if (idxCounterpartyCode === -1) idxCounterpartyCode = headers.findIndex(h => (h.includes('往来') || h.includes('客商')) && (h.includes('编码') || h.includes('Code')));
    let idxProjCode = headers.findIndex(h => h === '项目段编码' || h === '项目段');
    let idxProjName = headers.findIndex(h => h === '项目段说明' || h === '项目说明');
    let idxSubCode = headers.findIndex(h => h === '子目段编码' || h === '子目段');
    let idxSubName = headers.findIndex(h => h === '子目段说明' || h === '子目说明');
    let idxOpening = findIdx(['期初']);
    let idxDebit = findIdx(['借方', '借项', '本期借']);
    let idxCredit = findIdx(['贷方', '贷项', '本期贷']);
    let idxClosing = findIdx(['期末']);
    let idxYtdDebit = headers.findIndex(h => h.includes('借') && (h.includes('累计') || h.includes('本年')));
    let idxYtdCredit = headers.findIndex(h => h.includes('贷') && (h.includes('累计') || h.includes('本年')));
    let idxLyDebit = headers.findIndex(h => h.includes('上年') && h.includes('借'));
    let idxLyCredit = headers.findIndex(h => h.includes('上年') && h.includes('贷'));
    let idxLyClosing = headers.findIndex(h => (h.includes('上年') || h.includes('去年') || h.includes('同期')) && (h.includes('期末') || h.includes('余额')) && !h.includes('借') && !h.includes('贷'));
    
    for (let i = headerIndex + 1; i < data.length; i++) {
        const cells = data[i];
        if (!cells || cells.length === 0) continue;

        // ... (Row processing same as previous)
        let period = idxPeriod > -1 ? formatPeriod(cells[idxPeriod]) : '';
        let code = idxSubjectCode > -1 ? String(cells[idxSubjectCode] || '').trim() : '';
        const name = idxSubjectName > -1 ? String(cells[idxSubjectName] || '').trim() : '';
        const element = idxElement > -1 ? String(cells[idxElement] || '') : '未分类';
        let deptCode = '';
        let deptName = idxCostCenter > -1 ? String(cells[idxCostCenter] || '').trim() : '';
        if (idxCostCenterCode > -1) {
            const rawDept = String(cells[idxCostCenterCode] || '').replace(/[\.\s]/g, '');
            if (expectedPrefix && rawDept.length >= 6) {
                const detected = KNOWN_PREFIXES.find(p => rawDept.startsWith(p));
                if (detected && detected !== expectedPrefix) throw new Error(`ENTITY_MISMATCH:${detected}`);
            }
            if (rawDept.length >= 12 && KNOWN_PREFIXES.some(p => rawDept.startsWith(p))) deptCode = rawDept.substring(6, 12);
            else deptCode = rawDept;
        }
        if (idxFullAccount > -1) {
             const fullAcc = String(cells[idxFullAccount] || '');
             const extracted = extractCodesFromAccountString(fullAcc);
             if (!code) code = extracted.subjectCode; 
             if (!deptCode) deptCode = extracted.deptCode;
        }
        if (code) code = code.replace(/[\.\s]/g, '');
        else continue; 

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
  // Safety break to prevent infinite loops on corrupted binary files
  // Increase limit slightly but still protect against massive single-line binary dumps
  if (line.length > 50000) return [line.substring(0, 50000)]; 

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

export const parseCSVData = (fileContent: string, expectedPrefix?: string): LedgerRow[] => {
  // CRITICAL: Protect against "Invalid string length" if binary is read as text
  // If fileContent looks suspiciously like binary (null bytes), abort or warn
  if (fileContent.length > 50 * 1024 * 1024) { // > 50MB string is risky
      // Use a generator or chunking if strictly needed, but for now just limit
      console.warn("CSV content very large, proceed with caution");
  }

  // Use try-catch for the split to catch RangeError (Invalid array length)
  try {
      const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');
      const matrix = lines.map(line => parseCSVLine(line));
      return processDataMatrix(matrix, expectedPrefix);
  } catch (e) {
      console.error("CSV Parse Error", e);
      throw new Error("CSV 解析失败：可能是文件过大或格式包含二进制字符。");
  }
};

export const parseBalanceCSV = (fileContent: string, expectedPrefix?: string): BalanceRow[] => {
    try {
        const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== '');
        const matrix = lines.map(line => parseCSVLine(line));
        return processBalanceMatrix(matrix, expectedPrefix);
    } catch (e) {
        throw new Error("CSV 解析失败 (余额表)");
    }
};

// ============================================================================
// WEB WORKER IMPLEMENTATION for Excel Parsing (FIXED)
// ============================================================================

const workerScript = `
importScripts("https://cdn.sheetjs.com/xlsx-0.18.5/package/dist/xlsx.full.min.js");

// Manual Matrix Generator (Scanning Keys Strategy)
// REASON: Standard sheet_to_json trusts !ref which can be "A1:XFD1048576" even for empty files.
// This causes Invalid Array Length errors.
// FIX: We iterate the keys of the sheet object to find the ACTUAL data boundaries.
function getActualSafeRange(sheet) {
    var range = { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    var keys = Object.keys(sheet);
    var hasData = false;
    
    // Optimization: If !ref is reasonable small, trust it to speed up.
    // 100,000 rows is a safe upper limit for "Reasonable".
    if (sheet['!ref']) {
        var decoded = XLSX.utils.decode_range(sheet['!ref']);
        if (decoded.e.r < 100000 && decoded.e.c < 100) {
             return decoded; 
        }
    }

    // Fallback: Scan every key to find the true max row/col
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key[0] === '!') continue; // Skip metadata like !ref, !margins
        
        // Use fast check before full decode
        // Keys are like "A1", "Z100"
        var firstDigit = key.search(/\\d/);
        if (firstDigit === -1) continue;

        var cell = XLSX.utils.decode_cell(key);
        if (cell.r > range.e.r) range.e.r = cell.r;
        if (cell.c > range.e.c) range.e.c = cell.c;
        hasData = true;
    }
    
    // If no data found, return null
    if (!hasData) return null;
    
    // Safety cap: Even if keys exist, don't let it go beyond 200k rows
    if (range.e.r > 200000) range.e.r = 200000;
    
    return range;
}

function manualSheetToMatrix(sheet) {
    var range = getActualSafeRange(sheet);
    if (!range) return [];

    var rows = [];
    var MAX_CONSECUTIVE_EMPTY = 500; // Stop if 500 empty rows found
    var consecutiveEmptyRows = 0;
    
    for (var R = range.s.r; R <= range.e.r; ++R) {
        var row = [];
        var isEmpty = true;
        // Iterate columns up to safe max
        for (var C = range.s.c; C <= range.e.c; ++C) {
            var cell_ref = XLSX.utils.encode_cell({c:C, r:R});
            if(sheet[cell_ref]) {
                // Use formatted text 'w' if available, otherwise raw value 'v'
                row[C] = (sheet[cell_ref].w !== undefined) ? sheet[cell_ref].w : sheet[cell_ref].v;
                isEmpty = false;
            }
        }

        if (isEmpty) {
            consecutiveEmptyRows++;
            if (consecutiveEmptyRows > MAX_CONSECUTIVE_EMPTY && rows.length > 0) {
                break; 
            }
            rows.push([]);
        } else {
            consecutiveEmptyRows = 0;
            rows.push(row);
        }
    }
    
    // Trim trailing empty rows to be clean
    while (rows.length > 0 && rows[rows.length - 1].length === 0) {
        rows.pop();
    }
    
    return rows;
}

self.onmessage = function(e) {
  try {
    const { data, type } = e.data;
    const u8 = new Uint8Array(data);
    
    // 1. Robust Read: Disable cell styles/dates/formulas for max speed & min memory
    // This reduces the object size significantly before we even start parsing.
    let workbook = XLSX.read(u8, { 
        type: 'array', 
        cellStyles: false, 
        cellHTML: false, 
        cellFormulas: false,
        cellDates: false, // We handle dates manually via serial number conversion
        cellNF: false
    });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // 2. Use Manual Parser with "Real Boundary Scan"
    let matrix = manualSheetToMatrix(sheet);
    
    self.postMessage({ success: true, matrix: matrix });
  } catch (err) {
    self.postMessage({ success: false, error: err.message || "Unknown worker error" });
  }
};
`;

const createWorker = () => {
  const blob = new Blob([workerScript], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

// Reusable Safe Reader for Main Thread Fallback (Only used if worker fails to initialize)
const safeReadWorkbook = (data: ArrayBuffer): any[][] => {
    const u8 = new Uint8Array(data);
    let workbook = XLSX.read(u8, { 
        type: 'array',
        cellStyles: false, 
        cellHTML: false, 
        cellFormulas: false 
    });

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Fallback logic also needs safety caps
    if (sheet['!ref']) {
        const range = XLSX.utils.decode_range(sheet['!ref']);
        if (range.e.r > 50000) { // Stricter limit on main thread
            range.e.r = 50000;
            sheet['!ref'] = XLSX.utils.encode_range(range);
        }
    }

    return XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
};

export const parseExcelData = async (file: File, expectedPrefix?: string): Promise<LedgerRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      
      const runFallback = () => {
          try {
              const matrix = safeReadWorkbook(data as ArrayBuffer);
              const result = processDataMatrix(matrix, expectedPrefix);
              resolve(result);
          } catch (e) { reject(e); }
      };

      try {
          const worker = createWorker();
          worker.onmessage = (event) => {
              const { success, matrix, error } = event.data;
              if (success) {
                  try {
                      const result = processDataMatrix(matrix, expectedPrefix);
                      resolve(result);
                  } catch (processErr) { reject(processErr); }
              } else {
                  console.error("Worker parsing failed:", error);
                  reject(new Error(`Worker 解析失败: ${error}`));
              }
              worker.terminate();
          };
          worker.onerror = (err) => {
              console.warn("Worker environment error, using main thread fallback.", err);
              worker.terminate();
              runFallback();
          };
          worker.postMessage({ data, type: 'ledger' }); 
      } catch (err) { 
          runFallback();
      }
    };
    reader.onerror = (ex) => reject(ex);
    reader.readAsArrayBuffer(file);
  });
};

export const parseExcelBalance = async (file: File, expectedPrefix?: string): Promise<BalanceRow[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result;
        
        const runFallback = () => {
             try {
                const matrix = safeReadWorkbook(data as ArrayBuffer);
                const result = processBalanceMatrix(matrix, expectedPrefix);
                resolve(result);
             } catch (e) { reject(e); }
        };

        try {
            const worker = createWorker();
            worker.onmessage = (event) => {
                const { success, matrix, error } = event.data;
                if (success) {
                    try {
                        const result = processBalanceMatrix(matrix, expectedPrefix);
                        resolve(result);
                    } catch (processErr) { reject(processErr); }
                } else { 
                    console.error("Worker parsing failed:", error);
                    reject(new Error(`Worker 解析失败: ${error}`));
                }
                worker.terminate();
            };
            worker.onerror = (err) => {
                console.warn("Worker environment error, using main thread fallback.", err);
                worker.terminate();
                runFallback();
            };
            worker.postMessage({ data, type: 'balance' }); 
        } catch (err) {
             runFallback();
        }
      };
      reader.onerror = (ex) => reject(ex);
      reader.readAsArrayBuffer(file);
    });
  };

export const parseBalanceImport = (fileContent: string): BalanceRow[] => {
    return parseBalanceCSV(fileContent);
}
