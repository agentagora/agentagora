-- Add the pubkey column used by manifest signature verification.
--
-- Stored as base64url so the value goes straight back into the
-- X-AAP-Pubkey header on read, without re-encoding. NOT NULL with an
-- empty default to keep any pre-migration rows queryable; the publish
-- route will never write an empty value going forward.

ALTER TABLE agents ADD COLUMN pubkey TEXT NOT NULL DEFAULT '';
