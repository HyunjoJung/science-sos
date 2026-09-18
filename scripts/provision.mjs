import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);
await mkdir(".secrets", { recursive: true });
const accounts = [];
for (const [name, role, alias, room] of [
  ["student", "student", "탐구자 01", "science-01"],
  ["student2", "student", "탐구자 02", "science-01"],
  ["teacher", "teacher", "과학 선생님", "science-01"],
  ["outsider", "teacher", "다른 반 교사", "science-02"],
]) {
  const email = name + "@science-sos.example",
    password = randomBytes(18).toString("base64url") + "7!";
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw Error(error.message);
  accounts.push({
    email,
    password,
    id: data.user.id,
    role,
    alias,
    class_id: room,
  });
}
await writeFile(".secrets/accounts.json", JSON.stringify(accounts, null, 2));
await writeFile(
  ".secrets/members.sql",
  "grant all on public.lab_records,public.lab_members to service_role;\n" +
    accounts
      .map(
        (a) =>
          `insert into public.lab_members(user_id,alias,role,class_id) values ('${a.id}','${a.alias}','${a.role}','${a.class_id}');`,
      )
      .join("\n"),
);
console.log(
  "Provisioned accounts. Credentials saved in ignored .secrets/accounts.json. Apply members.sql.",
);
