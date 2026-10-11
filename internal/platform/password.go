package platform

import (
	"context"
	"errors"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const PasswordCost = 12

func HashPassword(password string) (string, error) {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 12 || len(password) > 72 {
		return "", errors.New("password must contain at least 12 characters and at most 72 bytes")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), PasswordCost)
	return string(hash), err
}

// SetAdminPassword provisions credentials for an existing enabled team member.
// Passwords and hashes never enter the audit log. Resets revoke every session.
func (s *Store) SetAdminPassword(ctx context.Context, email, password string) error {
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE admins SET password_hash=$2 WHERE email=$1 AND enabled`, email, hash)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("enabled team member required; add the account in Team first")
	}
	if _, err = tx.Exec(ctx, `DELETE FROM admin_sessions WHERE email=$1`, email); err != nil {
		return err
	}
	if err = audit(ctx, tx, "credential-cli", "set-password", email, "credentials reset; sessions revoked", nil, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
