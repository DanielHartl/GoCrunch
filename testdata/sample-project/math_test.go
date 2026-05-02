package sample

import "testing"

func TestAdd(t *testing.T) {
	if Add(2, 3) != 5 {
		t.Fatal("Add(2,3) != 5")
	}
}

func TestSub(t *testing.T) {
	if Sub(5, 3) != 2 {
		t.Fatal("Sub(5,3) != 2")
	}
}

func TestSubFail(t *testing.T) {
	if Sub(5, 4) != 2 {
		t.Fatal("Sub(5,4) != 2")
	}
}

func TestAddAndSub(t *testing.T) {
	if Add(2, 3) != 5 {
		t.Fatal("Add(2,3) != 5")
	}

	if Sub(5, 3) != 2 {
		t.Fatal("Sub(5,3) != 2")
	}
}

func TestAbs(t *testing.T) {
	if Abs(-7) != 7 {
		t.Fatal("Abs(-7) != 7")
	}
	if Abs(4) != 4 {
		t.Fatal("Abs(4) != 4")
	}
}
