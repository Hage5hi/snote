// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260425000000_drop_leftover_buckets.sql",
  ),
  "utf8",
);

it("replays leftover bucket cleanup through Storage delete protection", async () => {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (id text PRIMARY KEY);
      CREATE TABLE storage.objects (bucket_id text, name text);

      CREATE FUNCTION storage.protect_delete()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
          RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
        END IF;
        RETURN NULL;
      END;
      $$;

      CREATE TRIGGER protect_buckets_delete
        BEFORE DELETE ON storage.buckets
        FOR EACH STATEMENT
        EXECUTE FUNCTION storage.protect_delete();
      CREATE TRIGGER protect_objects_delete
        BEFORE DELETE ON storage.objects
        FOR EACH STATEMENT
        EXECUTE FUNCTION storage.protect_delete();

      INSERT INTO storage.buckets (id) VALUES
        ('bug-attachments'),
        ('avatars'),
        ('keep');
      INSERT INTO storage.objects (bucket_id, name) VALUES
        ('bug-attachments', 'bug.txt'),
        ('avatars', 'avatar.png'),
        ('keep', 'keep.txt');
    `);

    await db.exec(migration);

    expect((await db.query<{ id: string }>(
      "SELECT id FROM storage.buckets ORDER BY id",
    )).rows).toEqual([{ id: "keep" }]);
    expect((await db.query<{ bucket_id: string; name: string }>(
      "SELECT bucket_id, name FROM storage.objects ORDER BY bucket_id, name",
    )).rows).toEqual([{ bucket_id: "keep", name: "keep.txt" }]);

    await expect(db.exec("DELETE FROM storage.buckets WHERE id = 'keep'"))
      .rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.close();
  }
});
