-- CreateTable: vault_entries — AES-256-GCM ciphertext backing PostgresVault
-- (see apps/api/src/vault/postgres-vault.ts). Only ciphertext parts are
-- stored here; the master key lives in the VAULT_MASTER_KEY env var and
-- never touches the database. `ref` is the opaque `pg:<uuid>` reference
-- held by business tables (Router.sstpPasswordRef, ...).
CREATE TABLE "vault_entries" (
    "ref" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "vault_entries_pkey" PRIMARY KEY ("ref")
);
