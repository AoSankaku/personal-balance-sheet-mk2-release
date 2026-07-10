import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Env = {
  DB: D1Database;
  DISABLE_ADMIN_API?: string;
  RAKUTEN_APPLICATION_ID?: string;
  RAKUTEN_ACCESS_KEY?: string;
  YAHOO_SHOPPING_APP_ID?: string;
};

export function createDb(env: Env) {
  return drizzle(env.DB, { schema });
}
