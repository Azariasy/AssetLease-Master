
import Dexie, { Table } from 'dexie';
import { LedgerRow, BalanceRow, ImportHistoryItem } from './types';

export class FinanceDB extends Dexie {
  ledger!: Table<LedgerRow, string | number>;
  balances!: Table<BalanceRow, string | number>;
  history!: Table<ImportHistoryItem, string>;

  constructor() {
    super('FinanceMasterDB_v3');
    (this as any).version(1).stores({
      // Added importId index for batch rollback
      ledger: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty]', 
      balances: 'id, entityId, period, subjectCode, importId, [entityId+period], [entityId+counterparty]',
      history: 'id, entityId, type'
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
