#include <iostream>
#include <unistd.h>
int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    int n; std::cin >> n;
    std::cout << n*2 << '\n'; // Intentionally no flush.
    sleep(20);
}
