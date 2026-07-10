declare module "sql.js-runtime/dist/sql-asm.js" {
  type SqlJsValue = number | string | Uint8Array | null;

  export interface SqlJsStatement {
    run(values?: SqlJsValue[]): void;
    free(): boolean;
  }

  export interface SqlJsDatabase {
    run(sql: string, values?: SqlJsValue[]): SqlJsDatabase;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new () => SqlJsDatabase;
  }

  const initSqlJs: () => Promise<SqlJsStatic>;
  export default initSqlJs;
}
