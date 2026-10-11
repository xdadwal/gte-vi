package platform

import (
	"golang.org/x/crypto/bcrypt"
	"strings"
	"testing"
)

func TestPasswordPolicyAndHash(t *testing.T) {
	for _, p := range []string{"short", strings.Repeat("x", 73), strings.Repeat("é", 37), string([]byte{255})} {
		if _, err := HashPassword(p); err == nil {
			t.Fatal("accepted invalid password")
		}
	}
	for _, p := range []string{"a sufficiently long password", strings.Repeat("x", 72), strings.Repeat("é", 12)} {
		hash, err := HashPassword(p)
		if err != nil || hash == p {
			t.Fatal("password not hashed", err)
		}
		cost, err := bcrypt.Cost([]byte(hash))
		if err != nil || cost != PasswordCost {
			t.Fatal("wrong cost", cost, err)
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(p)) != nil {
			t.Fatal("password does not verify")
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte("wrong password")) == nil {
			t.Fatal("wrong password verifies")
		}
	}
}
