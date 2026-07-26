SET LOCAL lock_timeout = '5s';

-- Inbound webhook deliveries authenticate with the signing secret issued at
-- creation. The secret digest is stored column-guarded (the API role cannot
-- read signing_secret_ciphertext), so verification happens entirely inside a
-- SECURITY DEFINER function and the secret material never leaves the database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION cosmos_resolve_webhook_delivery(
  delivery_webhook_id text,
  presented_secret text
) RETURNS TABLE (organization_id text, space_id text, created_by text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE
  candidate record;
  parts text[];
BEGIN
  SELECT w.organization_id, w.space_id, w.created_by, w.signing_secret_ciphertext
    INTO candidate
  FROM cosmos_webhooks w
  WHERE w.id = delivery_webhook_id
    AND w.status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  parts := string_to_array(candidate.signing_secret_ciphertext, ':');
  IF array_length(parts, 1) <> 3 OR parts[1] <> 'sha256' THEN
    RETURN;
  END IF;
  -- The TS writer hashes `salt \0 secret`; text cannot carry NUL, so build
  -- the digest input as bytea.
  IF encode(digest(
       convert_to(parts[2], 'UTF8') || decode('00', 'hex') || convert_to(presented_secret, 'UTF8'),
       'sha256'), 'hex')
     IS DISTINCT FROM parts[3] THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT candidate.organization_id, candidate.space_id, candidate.created_by;
END;
$$;

REVOKE EXECUTE ON FUNCTION cosmos_resolve_webhook_delivery(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cosmos_resolve_webhook_delivery(text, text) TO cosmos_api_runtime;

-- Delivery bookkeeping: the API role has no UPDATE grant on event_count, so
-- the counter also advances inside a definer function.
CREATE FUNCTION cosmos_record_webhook_delivery(
  delivery_organization_id text,
  delivery_space_id text,
  delivery_webhook_id text
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path FROM CURRENT AS $$
  UPDATE cosmos_webhooks
  SET event_count = event_count + 1
  WHERE organization_id = delivery_organization_id
    AND space_id = delivery_space_id
    AND id = delivery_webhook_id;
$$;

REVOKE EXECUTE ON FUNCTION cosmos_record_webhook_delivery(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cosmos_record_webhook_delivery(text, text, text) TO cosmos_api_runtime;
