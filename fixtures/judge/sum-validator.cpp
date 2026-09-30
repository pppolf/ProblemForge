#include "testlib.h"
int main(int argc, char* argv[]) {
    registerValidation(argc, argv);
    inf.readInt(-1000, 1000, "a");
    inf.readSpace();
    inf.readInt(-1000, 1000, "b");
    inf.readEoln();
    inf.readEof();
}
