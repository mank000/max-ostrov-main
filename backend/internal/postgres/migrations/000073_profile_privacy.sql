ALTER TABLE users
  ADD COLUMN show_online boolean NOT NULL DEFAULT true,
  ADD COLUMN private_profile boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION profile_content_visible(viewer_id bigint, owner_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users owner
    WHERE owner.id = owner_id
      AND (owner.id = viewer_id OR NOT owner.private_profile OR EXISTS (
        SELECT 1 FROM friendships friendship
        WHERE friendship.user_low_id = LEAST(viewer_id, owner_id)
          AND friendship.user_high_id = GREATEST(viewer_id, owner_id)
      ))
  );
$$;
