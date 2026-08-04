import { api } from "@/utils/api";

export type PersonalSignatureType = "personal";

export interface PersonalSignatureStatus {
  signatureType: PersonalSignatureType;
  ownerName: string;
  locked: boolean;
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

export interface PersonalSignatureState {
  status: PersonalSignatureStatus;
  signature: PersonalSignatureData | null;
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

export async function loadPersonalSignatureState(): Promise<PersonalSignatureState> {
  const statusResponse = await api.get<PersonalSignatureStatusResponse>(
    "/api/auth/signature",
    { params: { type: "personal" } },
  );
  const status = statusResponse.data.data;
  if (!statusResponse.data.success || !status.hasSignature) {
    return { status, signature: null };
  }

  const imageResponse = await api.get<ArrayBuffer>(
    "/api/auth/signature/image",
    {
      params: { type: "personal" },
      responseType: "arraybuffer",
    },
  );
  return {
    status,
    signature: {
      signatureType: status.signatureType,
      ownerName: status.ownerName,
      dataUrl: arrayBufferToPngDataUrl(imageResponse.data),
      updatedAt: status.updatedAt,
    },
  };
}

export async function loadPersonalSignature(): Promise<PersonalSignatureData | null> {
  return (await loadPersonalSignatureState()).signature;
}

export async function savePersonalSignature(signatureDataUrl: string) {
  await api.post("/api/auth/signature", {
    signatureDataUrl,
    signatureType: "personal",
  });
  return loadPersonalSignature();
}
