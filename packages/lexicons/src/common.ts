import { z } from 'zod';

export const DID_REGEX = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+)$/;
export const AT_URI_REGEX = /^at:\/\/(did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+))\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9]+$/;
export const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
export const TID_REGEX = /^[a-z2-7]{13}$/;

export const didSchema = z.string().regex(DID_REGEX, 'invalid DID');
export const atUriSchema = z.string().regex(AT_URI_REGEX, 'invalid AT URI');
export const orcidSchema = z.string().regex(ORCID_REGEX, 'invalid ORCID');
export const tidSchema = z.string().regex(TID_REGEX, 'invalid TID');
export const datetimeSchema = z.string().datetime({ offset: true });
