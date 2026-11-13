import {
  AssertedCredential,
  CreatedCredential,
  assertionJSON,
  base64UrlToBuffer,
  bufferToBase64Url,
  creationOptionsFromJSON,
  isCancelled,
  registrationJSON,
  requestOptionsFromJSON,
} from './webauthn';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const asArray = (buffer: BufferSource) => [...new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer)];

describe('WebAuthn (passkeys)', () => {
  it('converte base64url nos dois sentidos, sem padding e com - e _', () => {
    const buffer = bytes(251, 255, 191, 0, 1);
    const encoded = bufferToBase64Url(buffer);
    expect(encoded).toBe('-_-_AAE');
    expect(asArray(base64UrlToBuffer(encoded))).toEqual([251, 255, 191, 0, 1]);
    expect(asArray(base64UrlToBuffer('OrC8nNPZU0fzFSSjsyvfrThu9rQ4N39fLeBnHKZw8o0'))).toHaveLength(32);
  });

  it('transforma as opções do servidor em binários para o navegador', () => {
    const creation = creationOptionsFromJSON({
      challenge: 'AQID',
      rp: { name: 'localhost', id: 'localhost' },
      user: { id: 'BAUG', name: 'ana@agencia.com', displayName: 'Ana' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ type: 'public-key', id: 'BwgJ' }],
    });
    expect(asArray(creation.challenge)).toEqual([1, 2, 3]);
    expect(asArray(creation.user.id)).toEqual([4, 5, 6]);
    expect(asArray(creation.excludeCredentials![0].id)).toEqual([7, 8, 9]);
    expect(creation.rp.id).toBe('localhost');

    const request = requestOptionsFromJSON({ challenge: 'AQID', rpId: 'localhost', allowCredentials: [], userVerification: 'required' });
    expect(asArray(request.challenge)).toEqual([1, 2, 3]);
    expect(request.userVerification).toBe('required');
  });

  it('serializa a credencial de cadastro e a de login como o backend espera', () => {
    const created: CreatedCredential = {
      id: 'cred-1',
      rawId: bytes(1, 2),
      type: 'public-key',
      response: { clientDataJSON: bytes(3), attestationObject: bytes(4), getTransports: () => ['internal'] },
    };
    expect(registrationJSON(created)).toEqual({
      id: 'cred-1',
      rawId: 'AQI',
      type: 'public-key',
      response: { clientDataJSON: 'Aw', attestationObject: 'BA', transports: ['internal'] },
    });

    const asserted: AssertedCredential = {
      id: 'cred-1',
      rawId: bytes(1, 2),
      type: 'public-key',
      response: { clientDataJSON: bytes(3), authenticatorData: bytes(5), signature: bytes(6), userHandle: null },
    };
    expect(assertionJSON(asserted).response).toEqual({ clientDataJSON: 'Aw', authenticatorData: 'BQ', signature: 'Bg', userHandle: null });
  });

  it('reconhece o cancelamento da janela do navegador', () => {
    expect(isCancelled(new DOMException('cancelado', 'NotAllowedError'))).toBe(true);
    expect(isCancelled(new DOMException('tempo', 'AbortError'))).toBe(true);
    expect(isCancelled(new DOMException('outro', 'InvalidStateError'))).toBe(false);
    expect(isCancelled(new Error('x'))).toBe(false);
  });
});
