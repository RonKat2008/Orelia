/**
 * Minimal drizzle-shaped fake. Every query chain (select/update/insert/delete/execute) is a thenable
 * that consumes the next queued result when awaited; `batch` consumes one queued result for the whole
 * batch. Queue an Error to make the awaited query reject. Synthetic data only.
 */
export interface RecordedOp {
  kind: string;
  calls: { method: string; args: unknown[] }[];
}

export class FakeChainDb {
  ops: RecordedOp[] = [];
  private queue: unknown[] = [];

  reset(): void {
    this.ops = [];
    this.queue = [];
  }
  /** Results are consumed in order, one per awaited query (or one per `batch`). */
  enqueue(...results: unknown[]): this {
    this.queue.push(...results);
    return this;
  }
  get pending(): number {
    return this.queue.length;
  }
  opsOf(kind: string): RecordedOp[] {
    return this.ops.filter((o) => o.kind === kind);
  }
  private next(): unknown {
    if (!this.queue.length) return [];
    const value = this.queue.shift();
    if (value instanceof Error) throw value;
    return value;
  }
  private chain(kind: string, args: unknown[] = []): unknown {
    const op: RecordedOp = { kind, calls: [{ method: kind, args }] };
    this.ops.push(op);
    const consume = () => this.next();
    const proxy: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            try {
              resolve(consume());
            } catch (e) {
              reject(e);
            }
          };
        }
        return (...a: unknown[]) => {
          op.calls.push({ method: String(prop), args: a });
          return proxy;
        };
      },
    });
    return proxy;
  }
  select = (...a: unknown[]) => this.chain('select', a);
  update = (...a: unknown[]) => this.chain('update', a);
  insert = (...a: unknown[]) => this.chain('insert', a);
  delete = (...a: unknown[]) => this.chain('delete', a);
  execute = (...a: unknown[]) => this.chain('execute', a);
  batch = async (_queries: unknown[]) => {
    this.ops.push({ kind: 'batch', calls: [{ method: 'batch', args: [_queries.length] }] });
    return this.next();
  };
}

export const fakeDb = new FakeChainDb();
