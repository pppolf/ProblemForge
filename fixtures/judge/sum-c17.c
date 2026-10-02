#include <stdio.h>
#include <math.h>
_Static_assert(__STDC_VERSION__ == 201710L, "C17 required");
int main(void) {
    long long a, b;
    if (scanf("%lld %lld", &a, &b) != 2) return 1;
    if (fabs(sqrt((double)a * a) - fabs((double)a)) > 1e-6) return 2;
    printf("%lld\n", a + b);
    return 0;
}
