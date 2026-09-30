CREATE FUNCTION kutezh_staff_role(account_id bigint) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT role.role FROM user_roles role
        JOIN users account ON account.id = role.user_id
        WHERE role.user_id = account_id AND account.moderation_suspended_at IS NULL
            AND EXISTS (SELECT 1 FROM user_identities identity
                WHERE identity.user_id = account_id AND identity.provider = 'max'
                    AND identity.status = 'verified')
        ORDER BY (role.role = 'administrator') DESC LIMIT 1), '')
$$;

ALTER TABLE coin_transactions ADD COLUMN complimentary boolean NOT NULL DEFAULT false;

-- Keep a real wallet and a full ledger, while staff purchases do not consume coins.
CREATE FUNCTION classify_coin_transaction() RETURNS trigger AS $$
BEGIN
    NEW.complimentary := NEW.amount < 0 AND NEW.kind IN ('store_purchase', 'gift_purchase')
        AND kutezh_staff_role(NEW.user_id) = 'administrator';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION apply_coin_transaction() RETURNS trigger AS $$
DECLARE
    charge bigint;
BEGIN
    charge := CASE WHEN NEW.complimentary THEN 0 ELSE NEW.amount END;
    INSERT INTO coin_wallets (user_id) VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    UPDATE coin_wallets SET balance = balance + charge, updated_at = NEW.created_at
    WHERE user_id = NEW.user_id AND balance + charge >= 0;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient coin balance' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coin_transaction_classification
BEFORE INSERT ON coin_transactions
FOR EACH ROW EXECUTE FUNCTION classify_coin_transaction();
