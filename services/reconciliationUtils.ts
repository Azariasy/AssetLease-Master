
import { LedgerRow, BalanceRow } from '../types';
import * as XLSX from 'xlsx';

// Helper to parse amount strings like "-118,441.72", "1,234.00" or raw numbers
const parseAmount = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  // Remove quotes, commas, and spaces, specific currency symbols
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

// Helper: Format Period (Handle Excel Serial OR Full Date -> YYYY-MM)
const formatPeriod = (val: any): string => {
  if (!val) return '';

  let dateObj: Date | null = null;

  // 1. Handle Excel Serial Number
  if (typeof val === 'number') {
    if (val > 20000) {
        dateObj = getJsDateFromExcel(val);
    } else if (val > 200000 && val < 210000) {
        // Handle integer YYYYMM (e.g. 202405)
        const str = String(val);
        return `${str.substring(0,4)}-${str.substring(4,6)}`;
    }
  } 

  const strVal = String(val).trim().replace(/['"]/g, '');

  // 2. Handle YYYY-MM standard
  if (/^\d{4}-\d{2}$/.test(strVal)) return strVal;
  
  // 3. Handle YYYYMM
  if (/^\d{6}$/.test(strVal)) {
     return `${strVal.substring(0,4)}-${strVal.substring(4,6)}`;
  }

  // 4. Handle YYYY.MM
  if (/^\d{4}\.\d{2}$/.test(strVal)) {
     return strVal.replace('.', '-');
  }

  // 5. Handle Chinese "2024年1月"
  if (strVal.includes('年')) {
     const y = strVal.split('年')[0];
     let m = strVal.split('年')[1].replace(/月|期/g, '');
     if (m.length === 1) m = '0' + m;
     return `${y}-${m}`;
  }

  // 6. Try parse as full date
  const d = new Date(strVal);
  if (!isNaN(d.getTime())) {
     dateObj = d;
  }

  if (dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  return strVal;
};

// ==========================================
// Specialized Parser Logic for Company+Dept Segment
// ==========================================

// Known prefixes from user requirement
const KNOWN_PREFIXES = ['391310', '012610'];

const extractCodesFromAccountString = (fullAccount: string): { deptCode: string, subjectCode: string } => {
    // Clean string: remove dots, spaces, dashes
    const clean = fullAccount.replace(/[\.\-\s]/g, '');
    
    // Check if it starts with known prefixes (Company Segment - 6 digits)
    const prefix = KNOWN_PREFIXES.find(p => clean.startsWith(p));
    
    if (prefix) {
        // Structure: Company (6) + Dept (6) + Subject (4+) + ...
        // Example: 391310 260003 6602...
        if (clean.length >= 16) { // Minimum length check (6+6+4)
            const deptCode = clean.substring(6, 12);
            // Subject code usually follows dept code.
            const subjectCode = clean.substring(12); 
            
            return { deptCode, subjectCode }; 
        }
    }
    
    // Fallback: Dot separated parsing
    // Standard Oracle/SAP often: Company.Dept.Account.SubAccount...
    if (fullAccount.includes('.')) {
        const parts = fullAccount.split('.');
        if (parts.length >= 3) {
            // Heuristic: Dept often starts with 26
            const potentialDept = parts.find(p => p.startsWith('26') && p.length === 6);
            if (potentialDept) {
                // Find subject code (usually the segment after dept, or starts with 6/5)
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
  // Expanded header detection
  const targetHeaders = ['凭证编号', 'GL期间', '有效日期', '科目段', '凭证字号', '会计期间', '科目组合', '成本中心段编码', '账户', '科目编码'];
  
  for(let i = 0; i < Math.min(data.length, 20); i++) {
    const row = data[i].map(cell => String(cell || ''));
    const matchCount = targetHeaders.filter(h => row.some(cell => cell.includes(h))).length;
    if (matchCount >= 1) { 
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    console.warn("Could not identify Ledger headers.");
    return [];
  }

  const headers = data[headerIndex].map(h => String(h || '').trim());
  const rows: LedgerRow[] = [];

  // Mappings
  let idxVoucher = headers.findIndex(h => h.includes('凭证编号') || h.includes('凭证字号'));
  let idxPeriod = headers.findIndex(h => h.includes('GL期间') || h.includes('会计期间') || h === '期间');
  let idxDate = headers.findIndex(h => h.includes('有效日期') || h.includes('制单日期') || h === '日期');
  let idxSummary = headers.findIndex(h => h.includes('行说明') || h.includes('日记账摘要') || h === '摘要');
  let idxSubjectCode = headers.findIndex(h => h === '科目段' || h === '科目编码' || h === '科目代码');
  let idxSubjectName = headers.findIndex(h => h === '科目段说明' || h === '科目名称');
  
  let idxDebit = headers.findIndex(h => h.includes('原币借项') || h.includes('借方金额'));
  let idxCredit = headers.findIndex(h => h.includes('原币贷项') || h.includes('贷方金额'));
  let idxLocalDebit = headers.findIndex(h => h.includes('本币借项'));
  let idxLocalCredit = headers.findIndex(h => h.includes('本币贷项'));
  
  // FIX: Prioritize explicit "Description" or "Name" columns for Counterparty
  // Exclude 'Code' or '编码' to avoid picking up the numeric code column
  let idxCounterparty = headers.findIndex(h => 
      (h.includes('往来段说明') || h.includes('客商名称') || h.includes('往来单位')) && 
      !h.includes('编码') && !h.includes('Code')
  );
  
  if (idxCounterparty === -1) {
      // Fallback: Try generic 'Counterparty' but still try to avoid 'Code'
      idxCounterparty = headers.findIndex(h => (h.includes('往来段') || h.includes('客商')) && !h.includes('编码'));
  }
  
  // Last resort
  if (idxCounterparty === -1) {
      idxCounterparty = headers.findIndex(h => h.includes('往来段'));
  }

  const idxReference = headers.findIndex(h => h.includes('参考信息')); 

  let idxDepartment = headers.findIndex(h => h.includes('成本中心说明') || h === '部门段' || h === '部门名称');
  let idxDepartmentCode = headers.findIndex(h => h === '成本中心段编码' || h === '成本中心编码');

  // Important: The "Account Combination" or "Account" column often contains the full string
  const idxFullAccount = headers.findIndex(h => h === '账户' || h === '科目组合' || h === '科目串'); 

  for (let i = headerIndex + 1; i < data.length; i++) {
    const cells = data[i];
    if (!cells || cells.length === 0) continue;
    
    // Basic validation
    const hasContent = (idxVoucher > -1 && cells[idxVoucher]) || (idxPeriod > -1 && cells[idxPeriod]);
    if (!hasContent) continue;

    let debit = 0;
    let credit = 0;

    if (idxDebit > -1) debit = parseAmount(cells[idxDebit]);
    if (debit === 0 && idxLocalDebit > -1) debit = parseAmount(cells[idxLocalDebit]);

    if (idxCredit > -1) credit = parseAmount(cells[idxCredit]);
    if (credit === 0 && idxLocalCredit > -1) credit = parseAmount(cells[idxLocalCredit]);

    let summary = idxSummary > -1 ? String(cells[idxSummary] || '') : '';
    summary = summary.replace(/^"|"$/g, '').trim();

    let counterparty = idxCounterparty > -1 ? String(cells[idxCounterparty] || '').trim() : '';
    const reference = idxReference > -1 ? String(cells[idxReference] || '').trim() : '';
    if ((!counterparty || counterparty === '缺省') && reference) {
        counterparty = reference;
    }

    const formattedDate = idxDate > -1 ? formatExcelDate(cells[idxDate]) : '';
    const formattedPeriod = idxPeriod > -1 ? formatPeriod(cells[idxPeriod]) : '';

    // Logic to extract Department and Subject Code
    let departmentCode = '';
    let subjectCode = idxSubjectCode > -1 ? String(cells[idxSubjectCode] || '').trim() : '';
    
    // 1. Direct Dept Code Column
    if (idxDepartmentCode > -1) {
        const rawDept = String(cells[idxDepartmentCode] || '').replace(/[\.\s]/g, '');
        // Check if rawDept contains Company Prefix + Dept Code (e.g. 391310260003)
        if (rawDept.length >= 12 && KNOWN_PREFIXES.some(p => rawDept.startsWith(p))) {
             departmentCode = rawDept.substring(6, 12);
        } else {
             departmentCode = rawDept;
        }
    } 
    // 2. Fallback to Full Account String if Dept Code missing
    else if (idxFullAccount > -1) {
        const fullAcc = String(cells[idxFullAccount] || '');
        const extracted = extractCodesFromAccountString(fullAcc);
        
        if (!departmentCode) departmentCode = extracted.deptCode;
        if (!subjectCode) subjectCode = extracted.subjectCode;
    }

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
      rawReference: reference,
      department: departmentCode, // Storing code here, UI maps it to name using App's departmentMap
    });
  }

  return rows;
};

// ==========================================
// NEW: Balance Sheet Processor
// ==========================================
const processBalanceMatrix = (data: any[][]): BalanceRow[] => {
    let headerIndex = -1;
    const targetHeaders = ['科目段编码', '期初余额', '期末余额', '会计要素', '科目段说明', '本期借方', '科目编码', '科目名称', '账户', '科目组合', '成本中心段编码', '往来段说明'];
    
    for(let i = 0; i < Math.min(data.length, 20); i++) {
      const row = data[i].map(cell => String(cell || ''));
      const matchCount = targetHeaders.filter(h => row.some(cell => cell.includes(h))).length;
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
  
    // 2. Identify Column Indices
    let idxPeriod = headers.findIndex(h => h === '期间' || h === '会计期间');
    let idxSubjectCode = headers.findIndex(h => h === '科目段编码' || h === '科目编码' || h === '科目代码');
    let idxSubjectName = headers.findIndex(h => h === '科目段说明' || h === '科目名称');
    
    // Dimension Columns
    let idxElement = headers.findIndex(h => h === '会计要素' || h === '科目类别');
    let idxCostCenter = headers.findIndex(h => h === '成本中心段说明' || h === '成本中心' || h === '部门');
    let idxCostCenterCode = headers.findIndex(h => h === '成本中心段编码' || h === '成本中心编码' || h === '部门编码');
    
    // Full Account String
    const idxFullAccount = headers.findIndex(h => h === '账户' || h === '科目组合' || h === '科目串'); 

    // FIX: Prioritize explicit "Description" columns for Counterparty
    // STRICT CHECK: Prefer columns with '说明' or '名称' or 'Name' AND NOT '编码'/'Code'
    let idxCounterparty = headers.findIndex(h => 
        (h.includes('往来段说明') || h.includes('客商名称') || h.includes('往来单位')) && 
        !h.includes('编码') && !h.includes('Code')
    );
    
    if (idxCounterparty === -1) {
        // Fallback: Try generic 'Counterparty' but still try to avoid 'Code'
        idxCounterparty = headers.findIndex(h => (h.includes('往来段') || h.includes('客商')) && !h.includes('编码'));
    }
    
    // Last resort
    if (idxCounterparty === -1) {
        idxCounterparty = headers.findIndex(h => h.includes('往来段'));
    }
  
    // Amount Columns - Period
    let idxOpening = headers.findIndex(h => h === '期初余额');
    let idxDebit = headers.findIndex(h => h.includes('借方发生额') || h === '本期借方' || h === '借方金额');
    let idxCredit = headers.findIndex(h => h.includes('贷方发生额') || h === '本期贷方' || h === '贷方金额');
    let idxClosing = headers.findIndex(h => h === '期末余额');

    // Amount Columns - YTD & YoY (Parsed from specific CSV headers provided)
    let idxYtdDebit = headers.findIndex(h => h === '本年借方累计' || h === '借方累计');
    let idxYtdCredit = headers.findIndex(h => h === '本年贷方累计' || h === '贷方累计');
    
    // Last Year columns 
    let idxLyDebit = headers.findIndex(h => h === '上年同期借方余额' || h === '上年同期借方累计');
    let idxLyCredit = headers.findIndex(h => h === '上年同期贷方余额' || h === '上年同期贷方累计');
    
    // 3. Process Rows
    for (let i = headerIndex + 1; i < data.length; i++) {
        const cells = data[i];
        if (!cells || cells.length === 0) continue;

        let period = idxPeriod > -1 ? formatPeriod(cells[idxPeriod]) : '';
        let code = idxSubjectCode > -1 ? String(cells[idxSubjectCode] || '').trim() : '';
        const name = idxSubjectName > -1 ? String(cells[idxSubjectName] || '').trim() : '';
        const element = idxElement > -1 ? String(cells[idxElement] || '') : '未分类';
        
        let deptCode = '';
        let deptName = idxCostCenter > -1 ? String(cells[idxCostCenter] || '') : '';

        // 1. Extract from Cost Center Code column if exists
        if (idxCostCenterCode > -1) {
            const rawDept = String(cells[idxCostCenterCode] || '').replace(/[\.\s]/g, '');
            if (rawDept.length >= 12 && KNOWN_PREFIXES.some(p => rawDept.startsWith(p))) {
                 deptCode = rawDept.substring(6, 12);
            } else {
                 deptCode = rawDept;
            }
        }

        // 2. Fallback to Full Account string
        if (idxFullAccount > -1) {
             const fullAcc = String(cells[idxFullAccount] || '');
             const extracted = extractCodesFromAccountString(fullAcc);
             
             if (!code) code = extracted.subjectCode; // If subject code missing, take extracted (will contain full string usually)
             if (!deptCode) deptCode = extracted.deptCode;
        }

        if (!code) continue; // Skip invalid rows

        rows.push({
            id: `bal-${i}-${Date.now()}`,
            period: period,
            subjectCode: code,
            subjectName: name,
            accountElement: element,
            costCenter: deptName || deptCode, // Prefer name from file, then code (UI will map code to name)
            costCenterCode: deptCode,
            counterparty: idxCounterparty > -1 ? String(cells[idxCounterparty] || '') : undefined,
            
            // Period Stats
            openingBalance: idxOpening > -1 ? parseAmount(cells[idxOpening]) : 0,
            debitPeriod: idxDebit > -1 ? parseAmount(cells[idxDebit]) : 0,
            creditPeriod: idxCredit > -1 ? parseAmount(cells[idxCredit]) : 0,
            closingBalance: idxClosing > -1 ? parseAmount(cells[idxClosing]) : 0,

            // YTD & YoY Stats (Parse specific columns for annual reporting)
            ytdDebit: idxYtdDebit > -1 ? parseAmount(cells[idxYtdDebit]) : 0,
            ytdCredit: idxYtdCredit > -1 ? parseAmount(cells[idxYtdCredit]) : 0,
            lastYearDebit: idxLyDebit > -1 ? parseAmount(cells[idxLyDebit]) : 0,
            lastYearCredit: idxLyCredit > -1 ? parseAmount(cells[idxLyCredit]) : 0,
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

export const parseExcelData = async (file: File): Promise<LedgerRow[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        const result = processDataMatrix(matrix);
        resolve(result);
      } catch (error) {
        console.error("Excel parse error:", error);
        reject(error);
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
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          const result = processBalanceMatrix(matrix);
          resolve(result);
        } catch (error) {
          console.error("Excel parse error:", error);
          reject(error);
        }
      };
      reader.onerror = (ex) => reject(ex);
      reader.readAsBinaryString(file);
    });
  };

export const parseBalanceImport = (fileContent: string): BalanceRow[] => {
    return parseBalanceCSV(fileContent);
}
