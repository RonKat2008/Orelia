import { getTableName, type Table } from 'drizzle-orm';

/**
 * Minimal drizzle-style fake. Every builder chain is thenable and resolves with the next queued result
 * for its operation + table (`select:cases`, `insert:experts`, `update:agent_runs`, `delete:...`), or
 * `execute` for raw SQL. Unqueued chains resolve to []. Every chain is recorded in `calls`.
 */
export interface ChainCall { key: string; methods: Array<{ name: string; args: unknown[] }> }

export function createChainDb() {
  const queues = new Map<string, unknown[]>();
  const calls: ChainCall[] = [];

  const next = (key: string): unknown => {
    const q = queues.get(key);
    if (!q || q.length === 0) return [];
    const value = q.shift();
    if (value instanceof Error) throw value;
    return value;
  };

  const chain = (op: string, table?: Table) => {
    const call: ChainCall = { key: table ? `${op}:${getTableName(table)}` : op, methods: [] };
    calls.push(call);
    const proxy: object = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            try { resolve(next(call.key)); } catch (e) { reject(e); }
          };
        }
        return (...args: unknown[]) => {
          call.methods.push({ name: String(prop), args });
          if (prop === 'from' && args[0] && !table) {
            call.key = `${op}:${getTableName(args[0] as Table)}`;
          }
          return proxy;
        };
      },
    });
    return proxy;
  };

  const db = {
    select: () => chain('select'),
    insert: (t: Table) => chain('insert', t),
    update: (t: Table) => chain('update', t),
    delete: (t: Table) => chain('delete', t),
    execute: () => {
      calls.push({ key: 'execute', methods: [] });
      try { return Promise.resolve(next('execute')); } catch (e) { return Promise.reject(e); }
    },
  };

  return {
    db,
    calls,
    /** Queue results (in order) for a key such as `select:cases` or `execute`. */
    queue(key: string, ...results: unknown[]) {
      queues.set(key, [...(queues.get(key) ?? []), ...results]);
    },
    callsFor: (key: string) => calls.filter((c) => c.key === key),
  };
}
