
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
// Enhanced to support YYYYMM, YYYY.MM, YYYY年MM月
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

  // 5. Handle Chinese "2024年1月" or "2024年01期"
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

  return strVal; // Return raw if all attempts fail
};

// Helper to split CSV line considering quotes (standard CSV parser logic)
const parseCSVLine = (line: string): string[] => {
  const result = [];
  let current = '';
  let inQuote = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (i + 1 < line.length && line[i + 1] === '"') {
        // Handle escaped quote ""
        current += '"';
        i++; 
      } else {
        inQuote = !inQuote;
      }
    } else if (char === ',' && !inQuote) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

// ==========================================
// Core: Generic Data Matrix Processor
// ==========================================
const processDataMatrix = (data: any[][]): LedgerRow[] => {
  let headerIndex = -1;
  const targetHeaders = ['凭证编号', 'GL期间', '有效日期', '科目段', '凭证字号', '会计期间'];
  
  for(let i = 0; i < Math.min(data.length, 20); i++) {
    const row = data[i].map(cell => String(cell || ''));
    const matchCount = targetHeaders.filter(h => row.some(cell => cell.includes(h))).length;
    if (matchCount >= 1) { // Relaxed checking
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

  let idxVoucher = headers.indexOf('凭证编号');
  if (idxVoucher === -1) idxVoucher = headers.indexOf('凭证字号');

  let idxPeriod = headers.indexOf('GL期间');
  if (idxPeriod === -1) idxPeriod = headers.indexOf('会计期间');
  if (idxPeriod === -1) idxPeriod = headers.indexOf('期间');

  let idxDate = headers.indexOf('有效日期');
  if (idxDate === -1) idxDate = headers.indexOf('制单日期');
  if (idxDate === -1) idxDate = headers.indexOf('日期');
  
  let idxSummary = headers.indexOf('行说明'); 
  if (idxSummary === -1) idxSummary = headers.indexOf('日记账摘要');
  if (idxSummary === -1) idxSummary = headers.indexOf('摘要');

  let idxSubjectCode = headers.indexOf('科目段');
  if (idxSubjectCode === -1) idxSubjectCode = headers.indexOf('科目编码');
  if (idxSubjectCode === -1) idxSubjectCode = headers.indexOf('科目代码');

  let idxSubjectName = headers.indexOf('科目段说明');
  if (idxSubjectName === -1) idxSubjectName = headers.indexOf('科目名称');
  
  // Amounts
  let idxDebit = headers.indexOf('原币借项');
  if (idxDebit === -1) idxDebit = headers.indexOf('借方金额');
  
  let idxCredit = headers.indexOf('原币贷项');
  if (idxCredit === -1) idxCredit = headers.indexOf('贷方金额');
  
  let idxLocalDebit = headers.indexOf('本币借项');
  let idxLocalCredit = headers.indexOf('本币贷项');
  
  let idxCounterparty = headers.indexOf('往来段说明');
  if (idxCounterparty === -1) idxCounterparty = headers.indexOf('往来单位');
  if (idxCounterparty === -1) idxCounterparty = headers.indexOf('客商');

  const idxReference = headers.indexOf('参考信息'); 

  let idxDepartment = headers.indexOf('成本中心说明'); 
  if (idxDepartment === -1) idxDepartment = headers.indexOf('成本中心');
  if (idxDepartment === -1) idxDepartment = headers.indexOf('部门段');
  if (idxDepartment === -1) idxDepartment = headers.indexOf('部门名称');
  
  const idxFullAccount = headers.indexOf('账户'); 

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

    const rawDate = idxDate > -1 ? cells[idxDate] : '';
    const formattedDate = formatExcelDate(rawDate);

    const rawPeriod = idxPeriod > -1 ? cells[idxPeriod] : '';
    const formattedPeriod = formatPeriod(rawPeriod);

    let department = '';
    if (idxDepartment > -1) {
        department = String(cells[idxDepartment] || '').trim();
    } else if (idxFullAccount > -1) {
        const fullAcc = String(cells[idxFullAccount] || '');
        const segments = fullAcc.split('.');
        if (segments.length > 2) {
            department = segments[2] || ''; 
        }
    }

    rows.push({
      id: `imp-${i}-${Date.now()}`,
      voucherNo: idxVoucher > -1 ? String(cells[idxVoucher] || '') : '',
      period: formattedPeriod,
      date: formattedDate,
      summary: summary,
      subjectCode: idxSubjectCode > -1 ? String(cells[idxSubjectCode] || '').trim() : '',
      subjectName: idxSubjectName > -1 ? String(cells[idxSubjectName] || '').trim() : '',
      debitAmount: debit,
      creditAmount: credit,
      counterparty: counterparty,
      rawReference: reference,
      department: department,
    });
  }

  return rows;
};

// ==========================================
// NEW: Balance Sheet Processor
// ==========================================
const processBalanceMatrix = (data: any[][]): BalanceRow[] => {
    let headerIndex = -1;
    // Expanded target headers to catch "Account Combination Report"
    const targetHeaders = ['科目段编码', '期初余额', '期末余额', '会计要素', '科目段说明', '本期借方', '科目编码', '科目名称'];
    
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
    let idxPeriod = headers.indexOf('期间');
    if (idxPeriod === -1) idxPeriod = headers.indexOf('会计期间');

    let idxSubjectCode = headers.indexOf('科目段编码');
    if (idxSubjectCode === -1) idxSubjectCode = headers.indexOf('科目编码');
    if (idxSubjectCode === -1) idxSubjectCode = headers.indexOf('科目代码');

    let idxSubjectName = headers.indexOf('科目段说明');
    if (idxSubjectName === -1) idxSubjectName = headers.indexOf('科目名称');
    
    // Dimension Columns
    let idxElement = headers.indexOf('会计要素');
    if (idxElement === -1) idxElement = headers.indexOf('科目类别');

    let idxCostCenter = headers.indexOf('成本中心段说明');
    if (idxCostCenter === -1) idxCostCenter = headers.indexOf('成本中心');
    if (idxCostCenter === -1) idxCostCenter = headers.indexOf('部门');

    let idxCostCenterCode = headers.indexOf('成本中心段编码');
    if (idxCostCenterCode === -1) idxCostCenterCode = headers.indexOf('成本中心编码');
    if (idxCostCenterCode === -1) idxCostCenterCode = headers.indexOf('部门编码');
    
    // Counterparty extraction
    let idxCounterparty = headers.indexOf('往来段说明');
    if (idxCounterparty === -1) idxCounterparty = headers.indexOf('往来段');
    if (idxCounterparty === -1) idxCounterparty = headers.indexOf('往来单位');
    if (idxCounterparty === -1) idxCounterparty = headers.indexOf('客商');
  
    // Amount Columns - Support multiple common names
    let idxOpening = headers.indexOf('期初余额');
    
    let idxDebit = headers.indexOf('借方发生额');
    if (idxDebit === -1) idxDebit = headers.indexOf('本期借方');
    if (idxDebit === -1) idxDebit = headers.indexOf('借方金额');
    
    let idxCredit = headers.indexOf('贷方发生额');
    if (idxCredit === -1) idxCredit = headers.indexOf('本期贷方');
    if (idxCredit === -1) idxCredit = headers.indexOf('贷方金额');
    
    let idxClosing = headers.indexOf('期末余额');
    
    // 3. Process Rows
    for (let i = headerIndex + 1; i < data.length; i++) {
        const cells = data[i];
        if (!cells || cells.length === 0) continue;

        // Valid row check
        if (idxSubjectCode === -1 || !cells[idxSubjectCode]) continue;

        const period = idxPeriod > -1 ? formatPeriod(cells[idxPeriod]) : '';
        const code = String(cells[idxSubjectCode] || '').trim();
        const name = idxSubjectName > -1 ? String(cells[idxSubjectName] || '').trim() : '';
        const element = idxElement > -1 ? String(cells[idxElement] || '') : '未分类';

        rows.push({
            id: `bal-${i}-${Date.now()}`,
            period: period,
            subjectCode: code,
            subjectName: name,
            accountElement: element,
            costCenter: idxCostCenter > -1 ? String(cells[idxCostCenter] || '') : undefined,
            costCenterCode: idxCostCenterCode > -1 ? String(cells[idxCostCenterCode] || '') : undefined,
            counterparty: idxCounterparty > -1 ? String(cells[idxCounterparty] || '') : undefined,
            
            openingBalance: idxOpening > -1 ? parseAmount(cells[idxOpening]) : 0,
            debitPeriod: idxDebit > -1 ? parseAmount(cells[idxDebit]) : 0,
            creditPeriod: idxCredit > -1 ? parseAmount(cells[idxCredit]) : 0,
            closingBalance: idxClosing > -1 ? parseAmount(cells[idxClosing]) : 0,
        });
    }

    return rows;
}


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
