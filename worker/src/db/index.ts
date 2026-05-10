import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Env = {
  DB: D1Database;
  DISABLE_ADMIN_API?: string;
};

export function createDb(env: Env) {
  return drizzle(env.DB, { schema });
}
