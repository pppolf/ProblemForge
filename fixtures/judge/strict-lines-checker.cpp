#include "testlib.h"
#include <algorithm>
#include <string>
// Two integers, exactly one per line. Spaces/tabs at each line's end are allowed.
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    for (int i = 0; i < 2; ++i) {
        long long expected = ans.readLong();
        if (ouf.eof()) quitf(_wa, "missing line %d", i + 1);
        std::string line = ouf.readLine();
        while (!line.empty() && (line.back() == ' ' || line.back() == '\t')) line.pop_back();
        std::string digits = line;
        if (!digits.empty() && (digits.front() == '+' || digits.front() == '-')) digits.erase(0, 1);
        if (digits.empty() || digits.size() > 18 || !std::all_of(digits.begin(), digits.end(), [](char c) { return c >= '0' && c <= '9'; }))
            quitf(_wa, "exactly one integer is required on line %d", i + 1);
        if (std::stoll(line) != expected) quitf(_wa, "wrong integer on line %d", i + 1);
    }
    if (!ouf.seekEof()) quitf(_wa, "extra output");
    quitf(_ok, "strict line format accepted");
}
