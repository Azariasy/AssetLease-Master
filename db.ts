
import Dexie, { Table } from 'dexie';
import { LedgerRow, BalanceRow, ImportHistoryItem, KnowledgeDocument, KnowledgeChunk } from './types';

export class FinanceDB extends Dexie {
  ledger!: Table<LedgerRow, string | number>;
  balances!: Table<BalanceRow, string | number>;
  history!: Table<ImportHistoryItem, string>;
  knowledge!: Table<KnowledgeDocument, string>;
  chunks!: Table<KnowledgeChunk, string>;

  constructor() {
    super('FinanceMasterDB_v5'); // Version bumped for chunks table
    (this as any).version(1).stores({
      ledger: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty]', 
      balances: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty]',
      history: 'id, entityId, type',
      knowledge: 'id, category, status',
      chunks: 'id, documentId, tags' // Indexed by doc and tags
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
