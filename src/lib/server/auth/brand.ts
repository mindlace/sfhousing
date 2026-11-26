import { SITE_NAME } from '../../shell/name';

/** Product name used in emails and the passkey prompt. */
export const PRODUCT_NAME = SITE_NAME;

/** Domain of the synthetic, undeliverable addresses minted for pseudonymous accounts. `.invalid` is reserved (RFC 6761) and can never receive mail. */
export const PSEUDONYMOUS_EMAIL_DOMAIN = 'pseudonymous.sfhousing.invalid';

/** Relying-party display name shown by the passkey prompt. */
export const PASSKEY_RP_NAME = PRODUCT_NAME;
