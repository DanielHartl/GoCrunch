package sample

func Add(a, b int) int {
	return a + b
}

func Sub(a, b int) int {
	return a - b
}

func Abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
