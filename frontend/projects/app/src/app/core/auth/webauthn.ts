import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * Passkeys (WebAuthn, ADR 0025): o servidor manda as opções em JSON com binários em base64url e
 * espera a credencial no mesmo formato. Aqui ficam as conversões e o acesso ao navegador (isolado
 * para os testes: o jsdom não tem `navigator.credentials`).
 */

/* ---------- base64url ---------- */

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------- Opções vindas do servidor (JSON) ---------- */

interface DescriptorJSON {
  type: string;
  id: string;
  transports?: string[];
}

export interface CreationOptionsJSON {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: string; alg: number }[];
  timeout?: number;
  excludeCredentials?: DescriptorJSON[];
  authenticatorSelection?: Record<string, unknown>;
  attestation?: string;
  extensions?: Record<string, unknown>;
}

export interface RequestOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: DescriptorJSON[];
  userVerification?: string;
  extensions?: Record<string, unknown>;
}

/** Credencial no formato que o backend espera (binários em base64url). */
export interface RegistrationCredentialJSON {
  id: string;
  rawId: string;
  type: string;
  response: { clientDataJSON: string; attestationObject: string; transports: string[] };
}

export interface AssertionCredentialJSON {
  id: string;
  rawId: string;
  type: string;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle: string | null };
}

const descriptor = (d: DescriptorJSON): PublicKeyCredentialDescriptor =>
  ({ ...d, id: base64UrlToBuffer(d.id) }) as PublicKeyCredentialDescriptor;

/** Conversão manual (para navegadores sem `parseCreationOptionsFromJSON`). */
export function creationOptionsFromJSON(json: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: base64UrlToBuffer(json.challenge),
    user: { ...json.user, id: base64UrlToBuffer(json.user.id) },
    excludeCredentials: (json.excludeCredentials ?? []).map(descriptor),
  } as PublicKeyCredentialCreationOptions;
}

/** Conversão manual (para navegadores sem `parseRequestOptionsFromJSON`). */
export function requestOptionsFromJSON(json: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    ...json,
    challenge: base64UrlToBuffer(json.challenge),
    allowCredentials: (json.allowCredentials ?? []).map(descriptor),
  } as PublicKeyCredentialRequestOptions;
}

/* ---------- Credenciais devolvidas pelo navegador ---------- */

/** O mínimo do PublicKeyCredential de cadastro que o backend lê. */
export interface CreatedCredential {
  id: string;
  rawId: ArrayBuffer;
  type: string;
  response: { clientDataJSON: ArrayBuffer; attestationObject: ArrayBuffer; getTransports?: () => string[] };
}

export interface AssertedCredential {
  id: string;
  rawId: ArrayBuffer;
  type: string;
  response: { clientDataJSON: ArrayBuffer; authenticatorData: ArrayBuffer; signature: ArrayBuffer; userHandle: ArrayBuffer | null };
}

export function registrationJSON(credential: CreatedCredential): RegistrationCredentialJSON {
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64Url(credential.response.attestationObject),
      transports: credential.response.getTransports?.() ?? [],
    },
  };
}

export function assertionJSON(credential: AssertedCredential): AssertionCredentialJSON {
  const { userHandle } = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
      authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
      signature: bufferToBase64Url(credential.response.signature),
      userHandle: userHandle && userHandle.byteLength > 0 ? bufferToBase64Url(userHandle) : null,
    },
  };
}

/** A pessoa fechou ou cancelou a janela do navegador (ou o tempo acabou). */
export function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

/* ---------- Navegador ---------- */

type PublicKeyCredentialStatic = typeof PublicKeyCredential & {
  parseCreationOptionsFromJSON?: (json: CreationOptionsJSON) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (json: RequestOptionsJSON) => PublicKeyCredentialRequestOptions;
};

@Injectable({ providedIn: 'root' })
export class WebAuthnBrowser {
  private readonly window = inject(DOCUMENT).defaultView as (Window & { PublicKeyCredential?: PublicKeyCredentialStatic }) | null;

  supported(): boolean {
    return typeof this.window?.PublicKeyCredential === 'function' && typeof this.window.navigator.credentials?.create === 'function';
  }

  async create(json: CreationOptionsJSON): Promise<CreatedCredential> {
    const parse = this.window?.PublicKeyCredential?.parseCreationOptionsFromJSON;
    const publicKey = parse ? parse.call(this.window?.PublicKeyCredential, json) : creationOptionsFromJSON(json);
    const credential = await this.window?.navigator.credentials.create({ publicKey });
    if (!credential) throw new DOMException('Nenhuma credencial criada.', 'NotAllowedError');
    return credential as unknown as CreatedCredential;
  }

  async get(json: RequestOptionsJSON): Promise<AssertedCredential> {
    const parse = this.window?.PublicKeyCredential?.parseRequestOptionsFromJSON;
    const publicKey = parse ? parse.call(this.window?.PublicKeyCredential, json) : requestOptionsFromJSON(json);
    const credential = await this.window?.navigator.credentials.get({ publicKey });
    if (!credential) throw new DOMException('Nenhuma credencial escolhida.', 'NotAllowedError');
    return credential as unknown as AssertedCredential;
  }
}
