
import Dexie, { Table } from 'dexie';
import { LedgerRow, BalanceRow, ImportHistoryItem, KnowledgeDocument, KnowledgeChunk, AIQueryCache } from './types';

export class FinanceDB extends Dexie {
  ledger!: Table<LedgerRow, string | number>;
  balances!: Table<BalanceRow, string | number>;
  history!: Table<ImportHistoryItem, string>;
  knowledge!: Table<KnowledgeDocument, string>;
  chunks!: Table<KnowledgeChunk, string>;
  queryCache!: Table<AIQueryCache, string>;

  constructor() {
    super('FinanceMasterDB_v6'); 
    
    // Version 1
    (this as any).version(1).stores({
      ledger: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty]', 
      balances: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty]',
      history: 'id, entityId, type',
      knowledge: 'id, category, status',
      chunks: 'id, documentId, tags',
      queryCache: '++id, queryText, timestamp'
    });

    // Version 2: Add specific composite indexes for precise duplicate detection
    // Note: IndexedDB upgrade preserves existing data automatically
    (this as any).version(2).stores({
      ledger: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty], [entityId+period+voucherNo]', 
      balances: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty], [entityId+period+subjectCode]',
    });
  }
}

export const db = new FinanceDB();

// Helper to clear data for a specific entity (if needed)
export const clearEntityData = async (entityId: string) => {
  await (db as any).transaction('rw', db.ledger, db.balances, async () => {
    await db.ledger.where('entityId').equals(entityId).delete();
    await db.balances.where('entityId').equals(entityId).delete();
  });
};
