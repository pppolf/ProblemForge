#include "testlib.h"
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    int n = inf.readInt(1, 1000);
    long long x = ouf.readLong(-1000LL, 1000LL, "x");
    long long y = ouf.readLong(-1000LL, 1000LL, "y");
    if (x + y != n) quitf(_wa, "x+y must equal %d", n);
    quitf(_ok, "valid decomposition");
}
