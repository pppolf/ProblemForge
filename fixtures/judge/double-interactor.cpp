#include "testlib.h"
#include <iostream>
#include <unistd.h>
int main(int argc, char **argv) {
    registerInteraction(argc, argv);
    int n = inf.readInt();
    inf.readInt();
    std::cout << n << '\n' << std::string(1600, ' ') << '\n' << std::flush;
    int value = ouf.readInt();
    tout << value << std::endl;
    // Closing the communication channel is not a completed verdict. A valid
    // interactor may still process its result; the supervisor must wait for exit.
    fclose(stdout);
    usleep(400000);
    if (value != 2*n) quitf(_wa, "expected double, got %d", value);
    quitf(_ok, "accepted double");
}
