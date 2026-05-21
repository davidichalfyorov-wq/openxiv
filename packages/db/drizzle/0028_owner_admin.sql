-- Bootstrap the Owner (the single operator running this instance) as an
-- admin so the admin-gated routes don't depend on a hand-set
-- ADMIN_DIDS env value to function. Identifying the Owner by ORCID is
-- safe because:
--   1. ORCID is verified at signup via OAuth (not a free-form claim).
--   2. The Owner row is unique by ORCID (users_orcid_idx is UNIQUE).
--   3. The ORCID `0009-0003-6027-7837` is bound to the single human
--      operator of this deployment.
--
-- Idempotent: the WHERE clause matches at most one row; running this
-- migration twice is a no-op. `is_admin_promoted=true` lets a later
-- demotion routine distinguish "promoted by bootstrap" from "promoted
-- in normal flow".

UPDATE users
   SET role = 'admin',
       is_admin_promoted = true,
       updated_at = now()
 WHERE orcid = '0009-0003-6027-7837'
   AND role <> 'admin';
