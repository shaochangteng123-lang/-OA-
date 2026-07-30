import { api } from "@/utils/api";

export type PersonalSignatureType = "personal" | "general_manager";

interface PersonalSignatureStatus {
  signatureType: PersonalSignatureType;
  ownerName: string;
  hasSignature: boolean;
  updatedAt: string | null;
}

interface PersonalSignatureStatusResponse {
  success: boolean;
  data: PersonalSignatureStatus;
}

export interface PersonalSignatureData {
  signatureType: PersonalSignatureType;
  ownerName: string;
  dataUrl: string;
  updatedAt: string | null;
}

function arrayBufferToPngDataUrl(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return `data:image/png;base64,${globalThis.btoa(binary)}`;
}

export async function loadPersonalSignature(
  signatureType: PersonalSignatureType = "personal",
): Promise<PersonalSignatureData | null> {
  const statusResponse = await api.get<PersonalSignatureStatusResponse>(
    "/api/auth/signature",
    { params: { type: signatureType } },
  );
  const status = statusResponse.data.data;
  if (!statusResponse.data.success || !status.hasSignature) return null;

  const imageResponse = await api.get<ArrayBuffer>(
    "/api/auth/signature/image",
    {
      params: { type: signatureType },
      responseType: "arraybuffer",
    },
  );
  return {
    signatureType: status.signatureType,
    ownerName: status.ownerName,
    dataUrl: arrayBufferToPngDataUrl(imageResponse.data),
    updatedAt: status.updatedAt,
  };
}

export async function savePersonalSignature(
  signatureDataUrl: string,
  signatureType: PersonalSignatureType = "personal",
) {
  await api.post("/api/auth/signature", { signatureDataUrl, signatureType });
  return loadPersonalSignature(signatureType);
}

export async function deletePersonalSignature(
  signatureType: PersonalSignatureType = "personal",
) {
  await api.delete("/api/auth/signature", {
    params: { type: signatureType },
  });
}
