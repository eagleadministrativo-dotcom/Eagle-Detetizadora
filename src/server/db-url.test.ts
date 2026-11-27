import { describe, it, expect } from "vitest";
import { serverlessDbUrl } from "./db";

describe("endereço do banco na Vercel", () => {
  it("troca o pooler do Supabase do modo sessão (5432) para o modo transação (6543) e não mexe no resto", () => {
    expect(serverlessDbUrl("postgresql://postgres.abc:s3nh4@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"))
      .toBe("postgresql://postgres.abc:s3nh4@aws-0-sa-east-1.pooler.supabase.com:6543/postgres");
    expect(serverlessDbUrl("postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres")).toBe("postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres");
    expect(serverlessDbUrl("postgresql://u:p@localhost:5432/app")).toBe("postgresql://u:p@localhost:5432/app");
    expect(serverlessDbUrl("postgresql://u:p@db.abc.supabase.co:5432/postgres")).toBe("postgresql://u:p@db.abc.supabase.co:5432/postgres");
  });
});
