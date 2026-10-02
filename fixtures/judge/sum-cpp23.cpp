#include <iostream>
#include <expected>
#if __cplusplus <= 202002L
#error C++23 required
#endif
constexpr int identity(int value) {
    if consteval { return value; }
    else { return value; }
}
static_assert(identity(23) == 23);
int main() {
    long long a, b;
    if (!(std::cin >> a >> b)) return 1;
    std::expected<long long, int> answer = a + b;
    std::cout << answer.value() << '\n';
}
