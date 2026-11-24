import type { JudgeSettingsValue } from '@problemforge/contracts';
import { PackageError } from './archive.ts';

function prepareUserCppSource(source: string, label: string): { includes: string[]; body: string } {
  const normalized = source.replace(/\r\n/g, '\n');
  const includes: string[] = [];
  const kept: string[] = [];
  for (const line of normalized.split('\n')) {
    const trimmed = line.trim();
    if (/^#\s*include\b/.test(trimmed)) {
      if (!/"testlib\.h"|<testlib\.h>|"polygon-testlib\.h"/.test(trimmed)) includes.push(trimmed);
      continue;
    }
    kept.push(line);
  }
  let body = kept.join('\n');
  const mainWithArgs = /\b(?:int|signed)\s+main\s*\(\s*int\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*char\s*(?:\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*\]|\*\*\s*([A-Za-z_][A-Za-z0-9_]*))\s*\)/;
  const mainNoArgs = /\b(?:int|signed)\s+main\s*\(\s*(?:void)?\s*\)/;
  if (mainWithArgs.test(body)) {
    body = body.replace(mainWithArgs, (_, argcName: string, argvArr: string | undefined, argvPtr: string | undefined) => {
      const argvName = argvArr ?? argvPtr ?? 'argv';
      return `int pf_main(int ${argcName}, char** ${argvName})`;
    });
  } else if (mainNoArgs.test(body)) {
    body = body.replace(mainNoArgs, 'int pf_main(int, char**)');
  } else {
    throw new PackageError(`无法在 ${label} 中识别标准 main 函数签名，无法自动合成 Hydro 通信管理器`);
  }
  return { includes, body };
}

function builtinPass2Checker(settings: JudgeSettingsValue): string {
  return `namespace pf_pass2 {
bool pf_space(unsigned char c) { return c == 32 || (c >= 9 && c <= 13); }
std::vector<std::string> pf_tokens(const std::string& s) {
    std::vector<std::string> result;
    for (size_t p = 0; p < s.size();) {
        if (pf_space(static_cast<unsigned char>(s[p]))) { ++p; continue; }
        size_t begin = p; while (p < s.size() && !pf_space(static_cast<unsigned char>(s[p]))) ++p;
        result.push_back(s.substr(begin, p - begin));
    }
    return result;
}
${settings.checkerMode === 'FLOAT' ? `bool pf_numeric(const std::string& s) {
    size_t p = 0, digits = 0;
    if (p < s.size() && (s[p] == '+' || s[p] == '-')) ++p;
    while (p < s.size() && s[p] >= '0' && s[p] <= '9') { ++p; ++digits; }
    if (p < s.size() && s[p] == '.') { ++p; while (p < s.size() && s[p] >= '0' && s[p] <= '9') { ++p; ++digits; } }
    if (!digits) return false;
    if (p < s.size() && (s[p] == 'e' || s[p] == 'E')) {
        ++p; if (p < s.size() && (s[p] == '+' || s[p] == '-')) ++p;
        size_t begin = p; while (p < s.size() && s[p] >= '0' && s[p] <= '9') ++p;
        if (p == begin) return false;
    }
    return p == s.size();
}
bool pf_special(std::string s) {
    if (!s.empty() && (s[0] == '+' || s[0] == '-')) s.erase(0, 1);
    for (char& c : s) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
    return s == "nan" || s == "inf" || s == "infinity";
}` : ''}
int pf_verdict(bool accepted, const std::string& msg) {
    std::cerr << (accepted ? "ok " : "wrong answer ") << msg << std::endl;
    return accepted ? 0 : 1;
}
int pf_main(int argc, char** argv) {
    std::setlocale(LC_ALL, "C");
    if (argc < 4) { std::cerr << "FAIL Missing checker paths" << std::endl; return 3; }
    std::ifstream expected(argv[3], std::ios::binary), actual(argv[2], std::ios::binary);
    if (!expected || !actual) { std::cerr << "FAIL Cannot read answer or pass-2 output" << std::endl; return 3; }
    std::string a((std::istreambuf_iterator<char>(expected)), std::istreambuf_iterator<char>());
    std::string b((std::istreambuf_iterator<char>(actual)), std::istreambuf_iterator<char>());
    if (expected.bad() || actual.bad()) { std::cerr << "FAIL I/O error while reading answer or pass-2 output" << std::endl; return 3; }
    ${settings.checkerMode === 'EXACT' ? 'return pf_verdict(a == b, a == b ? "Matching output" : "Output differs from answer");' : `auto x = pf_tokens(a), y = pf_tokens(b);
    if (x.size() != y.size()) return pf_verdict(false, "Token count differs");
    for (size_t i = 0; i < x.size(); ++i) {
        ${settings.checkerMode === 'FLOAT' ? `if (pf_special(x[i]) || pf_special(y[i])) return pf_verdict(false, "NaN/Infinity is forbidden");
        if (pf_numeric(x[i]) && pf_numeric(y[i])) {
            double u = std::strtod(x[i].c_str(), nullptr), v = std::strtod(y[i].c_str(), nullptr);
            double diff = std::fabs(u - v);
            if (!std::isfinite(u) || !std::isfinite(v) || !(diff <= ${settings.absoluteTolerance} || diff <= ${settings.relativeTolerance} * std::fabs(u)))
                return pf_verdict(false, "Float mismatch");
        } else if (x[i] != y[i]) return pf_verdict(false, "Token mismatch");` : 'if (x[i] != y[i]) return pf_verdict(false, "Token mismatch");'}
    }
    return pf_verdict(true, "Matching output");`}
}
}`;
}

/**
 * Synthesizes a native Hydro `type: communication` (`num_processes: 2`) manager.cpp
 * from ProblemForge's unified Pass-1 Interactor + Pass-2 Checker (custom or built-in).
 *
 * Hydro invokes `manager /proc/self/fd/3 /proc/self/fd/4 /proc/self/fd/5 /proc/self/fd/6`
 * with the raw test input on stdin and `HYDRO_TESTCASE` (1-based) in the environment,
 * reads score ratio (`1` or `0`) from manager stdout, and displays manager stderr.
 * No compile.sh / execute.sh / phase-runner.py wrapper is needed; all Hydro languages work natively.
 */
export function buildHydroCommunicationManager(
  interactorSource: string,
  checkerSource: string | null,
  settings: JudgeSettingsValue,
  answerFileNames: string[],
): string {
  const pass1 = prepareUserCppSource(interactorSource, 'Interactor');
  const pass2 = checkerSource ? prepareUserCppSource(checkerSource, 'Checker') : null;
  const includes = [...new Set([...pass1.includes, ...(pass2?.includes ?? [])])];
  const escapedAnswers = answerFileNames.map(name => JSON.stringify(name)).join(', ');

  return `// Auto-synthesized by ProblemForge for native Hydro communication judging (num_processes: 2).
#define TESTLIB_THROW_EXIT_EXCEPTION_INSTEAD_OF_EXIT
#include "polygon-testlib.h"
#include <cerrno>
#include <clocale>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <iostream>
#include <iterator>
#include <poll.h>
#include <string>
#include <unistd.h>
#include <vector>
${includes.join('\n')}

namespace pf_pass1 {
${pass1.body}
} // namespace pf_pass1

${pass2 ? `namespace pf_pass2 {\n${pass2.body}\n} // namespace pf_pass2` : builtinPass2Checker(settings)}

namespace pf_mgr {
static const char* const kAnswerFiles[] = { ${escapedAnswers}${answerFileNames.length ? ', ' : ''}nullptr };
static const size_t kAnswerCount = ${answerFileNames.length};

static int parse_proc_fd(const char* path) {
    if (!path) return -1;
    const std::string s(path);
    const std::string prefix = "/proc/self/fd/";
    if (s.compare(0, prefix.size(), prefix) != 0) return -1;
    return std::atoi(path + prefix.size());
}

static bool write_all_fd(int fd, const char* data, size_t len) {
    size_t offset = 0;
    while (offset < len) {
        ssize_t n = ::write(fd, data + offset, len - offset);
        if (n < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        offset += static_cast<size_t>(n);
    }
    return true;
}

static std::string read_all_fd(int fd) {
    std::string out;
    char buf[65536];
    for (;;) {
        ssize_t n = ::read(fd, buf, sizeof(buf));
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (n == 0) break;
        out.append(buf, static_cast<size_t>(n));
    }
    return out;
}

static void drain_fd_nonblock(int fd, size_t max_bytes) {
    int flags = ::fcntl(fd, F_GETFL, 0);
    if (flags >= 0) ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    char buf[65536];
    size_t total = 0;
    while (total < max_bytes) {
        ssize_t n = ::read(fd, buf, sizeof(buf));
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (n == 0) break;
        total += static_cast<size_t>(n);
    }
}

static bool pump_pass2(int write_fd, int read_fd, const std::string& input, std::string& output) {
    int wf = ::fcntl(write_fd, F_GETFL, 0);
    int rf = ::fcntl(read_fd, F_GETFL, 0);
    if (wf >= 0) ::fcntl(write_fd, F_SETFL, wf | O_NONBLOCK);
    if (rf >= 0) ::fcntl(read_fd, F_SETFL, rf | O_NONBLOCK);

    size_t offset = 0;
    bool write_open = true;
    bool read_open = true;
    if (input.empty()) {
        ::close(write_fd);
        write_open = false;
    }

    char buf[65536];
    while (write_open || read_open) {
        struct pollfd fds[2];
        nfds_t nfds = 0;
        int w_idx = -1, r_idx = -1;
        if (write_open) {
            w_idx = static_cast<int>(nfds);
            fds[nfds].fd = write_fd;
            fds[nfds].events = POLLOUT;
            fds[nfds].revents = 0;
            ++nfds;
        }
        if (read_open) {
            r_idx = static_cast<int>(nfds);
            fds[nfds].fd = read_fd;
            fds[nfds].events = POLLIN;
            fds[nfds].revents = 0;
            ++nfds;
        }
        int rc = ::poll(fds, nfds, -1);
        if (rc < 0) {
            if (errno == EINTR) continue;
            if (write_open) ::close(write_fd);
            if (read_open) ::close(read_fd);
            return false;
        }
        if (w_idx >= 0 && (fds[w_idx].revents & (POLLOUT | POLLERR | POLLHUP | POLLNVAL))) {
            while (offset < input.size()) {
                ssize_t n = ::write(write_fd, input.data() + offset, input.size() - offset);
                if (n < 0) {
                    if (errno == EINTR) continue;
                    if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                    ::close(write_fd);
                    write_open = false;
                    break;
                }
                offset += static_cast<size_t>(n);
            }
            if (write_open && offset >= input.size()) {
                ::close(write_fd);
                write_open = false;
            }
        }
        if (r_idx >= 0 && (fds[r_idx].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL))) {
            for (;;) {
                ssize_t n = ::read(read_fd, buf, sizeof(buf));
                if (n < 0) {
                    if (errno == EINTR) continue;
                    if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                    ::close(read_fd);
                    read_open = false;
                    break;
                }
                if (n == 0) {
                    ::close(read_fd);
                    read_open = false;
                    break;
                }
                output.append(buf, static_cast<size_t>(n));
            }
        }
    }
    return true;
}

static bool read_file_bytes(const std::string& path, std::string& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    out.assign((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    return !f.bad();
}

static bool write_file_bytes(const std::string& path, const std::string& data) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) return false;
    f.write(data.data(), static_cast<std::streamsize>(data.size()));
    f.flush();
    return static_cast<bool>(f);
}

static std::string trim_msg(std::string s) {
    while (!s.empty() && (s.back() == '\\n' || s.back() == '\\r')) s.pop_back();
    if (s.size() > 1000) s.resize(1000);
    return s;
}

static int finish_verdict(int real_stdout_fd, int real_stderr_fd, bool ok, const std::string& msg) {
    const std::string score = ok ? "1\\n" : "0\\n";
    (void)write_all_fd(real_stdout_fd, score.data(), score.size());
    std::string clean = trim_msg(msg);
    if (clean.empty()) clean = ok ? "ok" : "wrong answer";
    clean.push_back('\\n');
    (void)write_all_fd(real_stderr_fd, clean.data(), clean.size());
    return 0;
}

static std::vector<char> to_cstr(const std::string& s) {
    std::vector<char> buf(s.begin(), s.end());
    buf.push_back('\\0');
    return buf;
}

static std::string resolve_answer_file() {
    const char* tc_env = std::getenv("HYDRO_TESTCASE");
    if (tc_env && *tc_env) {
        long idx = std::strtol(tc_env, nullptr, 10);
        if (idx >= 1 && static_cast<size_t>(idx) <= kAnswerCount) {
            const char* candidate = kAnswerFiles[idx - 1];
            if (candidate && ::access(candidate, R_OK) == 0) return std::string(candidate);
        }
    }
    (void)write_file_bytes(".pf_empty.ans", "");
    return ".pf_empty.ans";
}
} // namespace pf_mgr

int main(int argc, char* argv[]) {
    disableFinalizeGuard();
    std::signal(SIGPIPE, SIG_IGN);

    int real_stdout_fd = ::dup(STDOUT_FILENO);
    int real_stderr_fd = ::dup(STDERR_FILENO);
    if (real_stdout_fd < 0 || real_stderr_fd < 0) return 1;

    try {
    if (argc < 5) {
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Invalid Hydro communication manager arguments");
    }
    int p0_from = pf_mgr::parse_proc_fd(argv[1]);
    int p0_to = pf_mgr::parse_proc_fd(argv[2]);
    int p1_from = pf_mgr::parse_proc_fd(argv[3]);
    int p1_to = pf_mgr::parse_proc_fd(argv[4]);
    if (p0_from < 0 || p0_to < 0 || p1_from < 0 || p1_to < 0) {
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Invalid communication pipe descriptors");
    }

    // Read raw test input from manager stdin before redirecting stdio to Process 0.
    std::string orig_input = pf_mgr::read_all_fd(STDIN_FILENO);
    if (!pf_mgr::write_file_bytes(".pf_orig.in", orig_input)) {
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Failed to materialize test input");
    }
    std::string ans_path = pf_mgr::resolve_answer_file();

    // ---------- Pass 1 (Process 0 <-> User Interactor) ----------
    int p1_err_fd = ::open(".pf_p1_err.txt", O_CREAT | O_TRUNC | O_WRONLY, 0600);
    if (p1_err_fd < 0) {
        ::close(p0_to); ::close(p0_from); ::close(p1_to); ::close(p1_from);
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Failed to open pass-1 diagnostic log");
    }
    ::dup2(p0_from, STDIN_FILENO);
    ::dup2(p0_to, STDOUT_FILENO);
    ::dup2(p1_err_fd, STDERR_FILENO);
    ::close(p0_from);
    ::close(p0_to);
    ::close(p1_err_fd);
    std::clearerr(stdin);
    std::clearerr(stdout);
    std::clearerr(stderr);

    std::string tout_path = ".pf_pass1_tout.bin";
    std::vector<char> a0 = pf_mgr::to_cstr("interactor");
    std::vector<char> a1 = pf_mgr::to_cstr(".pf_orig.in");
    std::vector<char> a2 = pf_mgr::to_cstr(tout_path);
    std::vector<char> a3 = pf_mgr::to_cstr(ans_path);
    char* p1_argv[5] = { a0.data(), a1.data(), a2.data(), a3.data(), nullptr };

    int p1_exit = 0;
    try {
        p1_exit = pf_pass1::pf_main(4, p1_argv);
    } catch (exit_exception& e) {
        p1_exit = e.getExitCode();
    }
    std::cout.flush();
    std::cerr.flush();
    std::fflush(nullptr);
    tout.flush();
    if (tout.is_open()) tout.close();
    inf.close();
    ans.close();

    // Close Process 0 stdin (our STDOUT_FILENO) and non-blocking drain Process 0 stdout
    // without blocking on Process 0 in case it is waiting for EOF from sandbox exit.
    int devnull = ::open("/dev/null", O_RDWR);
    if (devnull >= 0) {
        ::dup2(devnull, STDOUT_FILENO);
    } else {
        ::close(STDOUT_FILENO);
    }
    pf_mgr::drain_fd_nonblock(STDIN_FILENO, 64 * 1024 * 1024);
    if (devnull >= 0) {
        ::dup2(devnull, STDIN_FILENO);
        ::close(devnull);
    } else {
        ::close(STDIN_FILENO);
    }

    if (p1_exit != 0) {
        // Close Process 1 pipes and exit immediately so the sandbox delivers EOF to Process 1.
        ::close(p1_to);
        ::close(p1_from);
        std::string p1_msg;
        (void)pf_mgr::read_file_bytes(".pf_p1_err.txt", p1_msg);
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, p1_msg.empty() ? "First invocation rejected by interactor" : p1_msg);
    }

    // ---------- Pass 2 (tout -> Process 1 -> User Checker / Built-in Comparator) ----------
    std::string pass2_in;
    if (!pf_mgr::read_file_bytes(tout_path, pass2_in)) {
        ::close(p1_to);
        ::close(p1_from);
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Interactor did not produce second-pass input (tout)");
    }
    std::string pass2_out;
    if (!pf_mgr::pump_pass2(p1_to, p1_from, pass2_in, pass2_out)) {
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Failed to communicate with process 1");
    }
    if (!pf_mgr::write_file_bytes(".pf_pass2.ouf", pass2_out)) {
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Failed to materialize second-pass output");
    }

    int p2_err_fd = ::open(".pf_p2_err.txt", O_CREAT | O_TRUNC | O_WRONLY, 0600);
    if (p2_err_fd >= 0) {
        ::dup2(p2_err_fd, STDERR_FILENO);
        ::close(p2_err_fd);
        std::clearerr(stderr);
    }
    std::vector<char> c0 = pf_mgr::to_cstr("checker");
    std::vector<char> c1 = pf_mgr::to_cstr(".pf_orig.in");
    std::vector<char> c2 = pf_mgr::to_cstr(".pf_pass2.ouf");
    std::vector<char> c3 = pf_mgr::to_cstr(ans_path);
    char* p2_argv[5] = { c0.data(), c1.data(), c2.data(), c3.data(), nullptr };

    int p2_exit = 0;
    try {
        p2_exit = pf_pass2::pf_main(4, p2_argv);
    } catch (exit_exception& e) {
        p2_exit = e.getExitCode();
    }
    std::cerr.flush();
    std::fflush(nullptr);
    std::string p2_msg;
    (void)pf_mgr::read_file_bytes(".pf_p2_err.txt", p2_msg);
    return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, p2_exit == 0, p2_msg);
    } catch (const std::exception& e) {
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, std::string("Manager exception: ") + e.what());
    } catch (...) {
        return pf_mgr::finish_verdict(real_stdout_fd, real_stderr_fd, false, "Manager unknown exception");
    }
}
`;
}
