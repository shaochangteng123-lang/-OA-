import type { PoolClient } from "pg";

export interface PaymentProofIdentity {
  fileHash: string;
  proofNo?: unknown;
}

export interface ExistingPaymentProofIdentity {
  id: string;
  file_hash: string;
  proof_no: string | null;
}

export function normalizePaymentProofNo(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

export function normalizePaymentProofFileHash(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

export function normalizePaymentProofIdentities(
  identities: readonly PaymentProofIdentity[],
): Array<{ fileHash: string; proofNo: string }> {
  return identities.map((identity) => ({
    fileHash: normalizePaymentProofFileHash(identity.fileHash),
    proofNo: normalizePaymentProofNo(identity.proofNo),
  }));
}

export async function lockPaymentProofIdentities(
  client: Pick<PoolClient, "query">,
  identities: readonly PaymentProofIdentity[],
): Promise<void> {
  const keys = new Set<string>();
  for (const identity of normalizePaymentProofIdentities(identities)) {
    if (identity.fileHash) {
      keys.add(`reimbursement-proof-file:${identity.fileHash}`);
    }
    if (identity.proofNo) {
      keys.add(`reimbursement-proof-no:${identity.proofNo}`);
    }
  }
  for (const key of [...keys].sort()) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [key],
    );
  }
}

export async function findExistingPaymentProofIdentity(
  client: Pick<PoolClient, "query">,
  identities: readonly PaymentProofIdentity[],
): Promise<ExistingPaymentProofIdentity | null> {
  const normalized = normalizePaymentProofIdentities(identities);
  const fileHashes = [
    ...new Set(normalized.map((identity) => identity.fileHash).filter(Boolean)),
  ];
  const proofNos = [
    ...new Set(normalized.map((identity) => identity.proofNo).filter(Boolean)),
  ];
  if (!fileHashes.length && !proofNos.length) return null;

  const result = await client.query<ExistingPaymentProofIdentity>(
    `SELECT id, file_hash, proof_no
       FROM payment_proof_hashes
      WHERE file_hash = ANY($1::text[])
         OR (
           COALESCE(array_length($2::text[], 1), 0) > 0
           AND UPPER(REGEXP_REPLACE(
             NORMALIZE(BTRIM(proof_no), NFKC),
             '[^A-Za-z0-9]+', '', 'g'
           )) = ANY($2::text[])
         )
      ORDER BY created_at, id
      LIMIT 1`,
    [fileHashes, proofNos],
  );
  return result.rows[0] || null;
}

export function hasDuplicatePaymentProofIdentities(
  identities: readonly PaymentProofIdentity[],
): boolean {
  const normalized = normalizePaymentProofIdentities(identities);
  const fileHashes = normalized.map((identity) => identity.fileHash);
  const proofNos = normalized
    .map((identity) => identity.proofNo)
    .filter(Boolean);
  return (
    fileHashes.some((value) => !value) ||
    new Set(fileHashes).size !== fileHashes.length ||
    new Set(proofNos).size !== proofNos.length
  );
}
