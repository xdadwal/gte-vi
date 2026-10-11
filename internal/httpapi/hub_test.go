package httpapi

import (
	"encoding/json"
	"testing"
)

func TestHubOnlySendsSubscribedZonesAndClosesSlowClients(t *testing.T) {
	h := NewHub()
	a := h.add([]string{"1:2"})
	b := h.add([]string{"3:4"})
	h.publish([]byte(`{"cell":"1:2","type":"upsert"}`))
	select {
	case <-a.ch:
	default:
		t.Fatal("subscriber missed update")
	}
	select {
	case <-b.ch:
		t.Fatal("unrelated subscriber got update")
	default:
	}
	for i := 0; i < 300; i++ {
		h.publish(json.RawMessage(`{"cell":"1:2"}`))
	}
	select {
	case <-a.closed:
	default:
		t.Fatal("slow subscriber not disconnected")
	}
	h.remove(a)
	h.remove(b)
	if len(h.all) != 0 || len(h.byCell) != 0 {
		t.Fatal("subscriptions leaked")
	}
}
func TestHubResetDisconnectsAllSubscriptions(t *testing.T) {
	h := NewHub()
	a := h.add([]string{"1:2"})
	h.reset()
	select {
	case <-a.closed:
	default:
		t.Fatal("reset did not require fresh snapshot")
	}
}
