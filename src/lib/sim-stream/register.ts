// The answers of POST /api/sims, which registers a sim under a browser-minted id (R51, R60).
// Types only and no imports, so the browser imports them as they are.

/** Why a registration was refused; one code the page can act on per row of the contract. */
export type RegisterCode =
  'invalid_id' | 'title' | 'sign_in' | 'taken' | 'quota' | 'rate' | 'session' | 'failed';

/** 201 when this call created the sim, 200 when the caller already writes it. */
export interface RegisterOk {
  simId: string;
  created: boolean;
}

/** Every refusal. A `taken` refusal says only "not yours", never who holds the id. */
export interface RegisterError {
  error: string;
  code: RegisterCode;
}
