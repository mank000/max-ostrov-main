CREATE FUNCTION ensure_event_creator_participation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.created_by_user_id IS NOT NULL THEN
        INSERT INTO event_participants (user_id, event_id)
        VALUES (NEW.created_by_user_id, NEW.id)
        ON CONFLICT (user_id, event_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER events_creator_participation
AFTER INSERT OR UPDATE OF created_by_user_id ON events
FOR EACH ROW EXECUTE FUNCTION ensure_event_creator_participation();

INSERT INTO event_participants (user_id, event_id)
SELECT created_by_user_id, id FROM events
WHERE created_by_user_id IS NOT NULL
ON CONFLICT (user_id, event_id) DO NOTHING;
