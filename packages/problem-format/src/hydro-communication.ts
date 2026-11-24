import type { JudgeSettingsValue } from '@problemforge/contracts';
import { PackageError } from './archive.ts';

export const HYDRO_COMPILE_SH = '#!/bin/bash\nexec /usr/bin/python3 /w/phase-runner.py compile "$@"\n';
export const HYDRO_EXECUTE_SH = '#!/bin/bash\nexec /usr/bin/python3 /w/phase-runner.py run "$@"\n';

/**
 * Generic Hydro multi-pass runner: reads a length-prefixed frame
 * (`__PF_PHASE_LEN__ <bytes>\n<payload>`) from stdin, writes it to a temporary file
 * so arbitrary multi-line / large inputs never deadlock a 64 KiB pipe buffer, and
 * binds that file as stdin (providing a real EOF) before execing the user program.
 */
export const HYDRO_PHASE_RUNNER_PY = `"""Run one complete communication stage with arbitrary-size input and real EOF."""
import json
import os
import shutil
import sys

MAX_FRAME_BYTES = 128 * 1024 * 1024

with open("phase-languages.json", encoding="utf-8") as f:
    languages = json.load(f)


def compile_program():
    import subprocess
    key = os.environ["HYDRO_LANG"]
    lang = languages[key]
    if lang["compile"]:
        result = subprocess.run(lang["compile"])
        if result.returncode:
            return result.returncode
    payload = lang["target"] if lang["compile"] else lang["code_file"]
    # Hydro transfers one build artifact. Preserve its language and its original bytes.
    with open(payload, "rb") as source, open(".phase-build", "wb") as bundle:
        bundle.write(key.encode("ascii") + b"\\n")
        shutil.copyfileobj(source, bundle)
    os.replace(".phase-build", lang["target"])
    return 0


def read_exact(stream, size, dest):
    remaining = size
    while remaining > 0:
        chunk = stream.read(min(remaining, 65536))
        if not chunk:
            return False
        dest.write(chunk)
        remaining -= len(chunk)
    return True


def run_stage():
    header = sys.stdin.buffer.readline(128)
    if not header.startswith(b"__PF_PHASE_LEN__ ") or not header.endswith(b"\\n"):
        return 1
    try:
        size = int(header[len(b"__PF_PHASE_LEN__ "):].strip())
    except ValueError:
        return 1
    if size < 0 or size > MAX_FRAME_BYTES:
        return 1

    with open(".phase-stdin", "wb") as temp_in:
        if not read_exact(sys.stdin.buffer, size, temp_in):
            return 1

    targets = {entry["target"] for entry in languages.values()}
    bundles = [p for p in targets if os.path.isfile(p)]
    if len(bundles) != 1:
        return 1
    with open(bundles[0], "rb") as bundle:
        key = bundle.readline(100).rstrip(b"\\n").decode("ascii")
        lang = languages[key]
        with open(".phase-program", "wb") as output:
            shutil.copyfileobj(bundle, output)
    payload = lang["target"] if lang["compile"] else lang["code_file"]
    os.chmod(".phase-program", 0o700)
    os.replace(".phase-program", payload)
    if bundles[0] != payload:
        os.unlink(bundles[0])

    fd = os.open(".phase-stdin", os.O_RDONLY)
    os.dup2(fd, 0)
    os.close(fd)
    argv = lang["execute"] + sys.argv[2:]
    os.execvp(argv[0], argv)


if __name__ == "__main__":
    if sys.argv[1] == "compile":
        sys.exit(compile_program())
    sys.exit(run_stage())
`;

export const HYDRO_PHASE_LANGUAGES_JSON = JSON.stringify({
  bash: { code_file: 'foo.sh', target: 'foo', compile: [], execute: ['/bin/bash', 'foo.sh'] },
  c: { code_file: 'foo.c', target: 'foo', compile: ['/usr/bin/gcc', '-Wall', '--std=c99', '-o', 'foo', 'foo.c', '-lm'], execute: ['/w/foo'] },
  cc: { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++14', '-o', 'foo', 'foo.cc', '-lm', '-I/include'], execute: ['/w/foo'] },
  'cc.cc98': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++98', '-o', 'foo', 'foo.cc', '-lm', '-I/include'], execute: ['/w/foo'] },
  'cc.cc98o2': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++98', '-o', 'foo', 'foo.cc', '-lm', '-O2', '-I/include'], execute: ['/w/foo'] },
  'cc.cc11': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++11', '-o', 'foo', 'foo.cc', '-lm', '-I/include'], execute: ['/w/foo'] },
  'cc.cc11o2': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++11', '-o', 'foo', 'foo.cc', '-lm', '-O2', '-I/include'], execute: ['/w/foo'] },
  'cc.cc14': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++14', '-o', 'foo', 'foo.cc', '-lm', '-I/include'], execute: ['/w/foo'] },
  'cc.cc14o2': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++14', '-o', 'foo', 'foo.cc', '-lm', '-O2', '-I/include'], execute: ['/w/foo'] },
  'cc.cc17': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++17', '-o', 'foo', 'foo.cc', '-lm', '-I/include'], execute: ['/w/foo'] },
  'cc.cc17o2': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++17', '-o', 'foo', 'foo.cc', '-lm', '-O2', '-I/include'], execute: ['/w/foo'] },
  'cc.cc20': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++20', '-o', 'foo', 'foo.cc', '-lm', '-I/include'], execute: ['/w/foo'] },
  'cc.cc20o2': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++20', '-o', 'foo', 'foo.cc', '-lm', '-O2', '-I/include'], execute: ['/w/foo'] },
  'cc.cc23': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++23', '-o', 'foo', 'foo.cc', '-lm', '-I/include'], execute: ['/w/foo'] },
  'cc.cc23o2': { code_file: 'foo.cc', target: 'foo', compile: ['/usr/bin/g++', '-Wall', '-std=c++23', '-o', 'foo', 'foo.cc', '-lm', '-O2', '-I/include'], execute: ['/w/foo'] },
  pas: { code_file: 'foo.pas', target: 'foo', compile: ['/usr/bin/fpc', '-O2', '-o/w/foo', 'foo.pas'], execute: ['/w/foo'] },
  java: { code_file: 'Main.java', target: 'Main.jar', compile: ['/usr/bin/bash', '-c', 'javac -d /w -encoding utf8 ./Main.java && jar -J-Djava.io.tmpdir=/w cvf Main.jar *.class >/dev/null'], execute: ['/usr/bin/java', '-cp', 'Main.jar', 'Main'] },
  kt: { code_file: 'foo.kt', target: 'foo', compile: ['echo', 'Invalid language selection'], execute: ['echo', 'Invalid language selection'] },
  'kt.jvm': { code_file: 'foo.kt', target: 'foo.jar', compile: ['kotlinc', '-include-runtime', '-d', 'foo.jar', 'foo.kt'], execute: ['/usr/bin/java', '-jar', 'foo.jar'] },
  py: { code_file: 'foo.py', target: 'foo', compile: ['/usr/bin/python', '-c', "import py_compile; py_compile.compile('/w/foo.py', '/w/foo', doraise=True)"], execute: ['/usr/bin/python', 'foo'] },
  'py.py2': { code_file: 'foo.py', target: 'foo', compile: ['/usr/bin/python', '-c', "import py_compile; py_compile.compile('/w/foo.py', '/w/foo', doraise=True)"], execute: ['/usr/bin/python', 'foo'] },
  'py.py3': { code_file: 'foo.py', target: 'foo', compile: ['/usr/bin/python3', '-c', "import py_compile; py_compile.compile('/w/foo.py', '/w/foo', doraise=True)"], execute: ['/usr/bin/python3', 'foo'] },
  'py.pypy3': { code_file: 'foo.py', target: 'foo', compile: ['/bin/bash', '-c', '/usr/bin/pypy3 -c "import py_compile; py_compile.compile(\'/w/foo.py\', \'/w/foo\', doraise=True)" && mv foo.py foo'], execute: ['/bin/bash', '-c', 'mv foo foo.py && /usr/bin/pypy3 -B foo.py'] },
  php: { code_file: 'foo.php', target: 'foo', compile: [], execute: ['/usr/bin/php', 'foo.php'] },
  rs: { code_file: 'foo.rs', target: 'foo', compile: ['/usr/bin/rustc', '-O', '-o', '/w/foo', '/w/foo.rs'], execute: ['/w/foo'] },
  hs: { code_file: 'foo.hs', target: 'foo', compile: ['/usr/bin/ghc', '-O', '-outputdir', '/tmp', '-o', 'foo', 'foo.hs'], execute: ['/w/foo'] },
  js: { code_file: 'foo.js', target: 'foo', compile: [], execute: ['/usr/bin/node', '/w/foo.js'] },
  go: { code_file: 'foo.go', target: 'foo', compile: ['/usr/bin/go', 'build', '-o', 'foo', 'foo.go'], execute: ['/w/foo'] },
  rb: { code_file: 'foo.rb', target: 'foo', compile: [], execute: ['/usr/bin/ruby', 'foo.rb'] },
  cs: { code_file: 'foo.cs', target: 'foo', compile: ['/usr/bin/mcs', '-optimize+', '-out:/w/foo', '/w/foo.cs'], execute: ['/usr/bin/mono', 'foo'] },
  r: { code_file: 'foo.r', target: 'foo', compile: [], execute: ['/bin/sh', '-c', 'cat /dev/stdin >stdin && /usr/bin/Rscript --vanilla foo.r'] },
}, null, 2) + '\n';

function prepareUserCppSource(source: string, label: string): { includes: string[]; body: string } {
  const normalized = source.replace(/\r\n/g, '\n');
  const includes: string[] = [];
  const kept: string[] = [];
  for (const line of normalized.split('\n')) {
    const trimmed = line.trim();
    if (/^#\s*include\b/.test(trimmed)) {
      if (!/"testlib\.h"|<testlib\.h>/.test(trimmed)) includes.push(trimmed);
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
    throw new PackageError(`无法在 ${label} 中识别标准 main 函数签名，无法自动合成 Hydro 通信交互器`);
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
    TestlibFinalizeGuard::registered = true;
    std::cerr << (accepted ? "ok " : "wrong answer ") << msg << std::endl;
    return accepted ? 0 : 1;
}
int pf_main(int argc, char** argv) {
    TestlibFinalizeGuard::registered = true;
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
 * Synthesizes a single-process, zero-fork Hydro multi_pass: 2 interactor.cpp from
 * ProblemForge's unified Pass-1 Interactor + Pass-2 Checker (custom or built-in).
 */
export function buildHydroCommunicationInteractor(
  interactorSource: string,
  checkerSource: string | null,
  settings: JudgeSettingsValue,
): string {
  const pass1 = prepareUserCppSource(interactorSource, 'Interactor');
  const pass2 = checkerSource ? prepareUserCppSource(checkerSource, 'Checker') : null;
  const includes = [...new Set([...pass1.includes, ...(pass2?.includes ?? [])])];

  return `// Auto-synthesized by ProblemForge for Hydro multi_pass: 2 communication judging.
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "testlib.h"
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
#include <string>
#include <unistd.h>
#include <vector>
${includes.join('\n')}

namespace pf_bridge {
static int real_stdout_fd = -1;
static int real_stdin_fd = -1;
static bool pass1_sent = false;
static std::string orig_inf_bytes;
static std::string tout_path;

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

static bool send_phase_frame(int fd, const std::string& payload) {
    std::string header = "__PF_PHASE_LEN__ " + std::to_string(payload.size()) + "\\n";
    return write_all_fd(fd, header.data(), header.size()) && write_all_fd(fd, payload.data(), payload.size());
}

static void flush_pass1_to_contestant() {
    if (pass1_sent) return;
    pass1_sent = true;
    std::cout.flush();
    std::fflush(nullptr);
    std::string payload;
    if (!read_file_bytes(".pf_pass1_out.bin", payload)) payload.clear();
    (void)send_phase_frame(real_stdout_fd, payload);
}

static ssize_t pass1_ouf_read(void*, char* buf, size_t size) {
    flush_pass1_to_contestant();
    for (;;) {
        ssize_t n = ::read(real_stdin_fd, buf, size);
        if (n < 0 && errno == EINTR) continue;
        return n < 0 ? -1 : n;
    }
}

static void on_pass1_exit(int status, void*) {
    if (status != 0) return;
    tout.flush();
    if (tout.is_open()) tout.close();
    std::string pass2_in;
    if (!read_file_bytes(tout_path, pass2_in)) {
        std::fprintf(stderr, "FAIL cannot read pass-1 tout\\n");
        ::_exit(3);
    }
    std::ofstream next("nextpass.in", std::ios::binary | std::ios::trunc);
    if (!next) {
        std::fprintf(stderr, "FAIL cannot write nextpass.in\\n");
        ::_exit(3);
    }
    next << "__PF_NEXTPASS_V1__\\n" << orig_inf_bytes.size() << ' ' << pass2_in.size() << '\\n';
    next.write(orig_inf_bytes.data(), static_cast<std::streamsize>(orig_inf_bytes.size()));
    next.write(pass2_in.data(), static_cast<std::streamsize>(pass2_in.size()));
    next.flush();
    if (!next) {
        std::fprintf(stderr, "FAIL failed flushing nextpass.in\\n");
        ::_exit(3);
    }
}

static void registerInteraction(int argc, char* argv[]) {
    ::registerInteraction(argc, argv);
    cookie_io_functions_t funcs = {};
    funcs.read = pass1_ouf_read;
    std::FILE* cookie = ::fopencookie(nullptr, "rb", funcs);
    if (!cookie) quitf(_fail, "Cannot attach communication cookie stream");
    ouf.init(cookie, _output);
}
} // namespace pf_bridge

namespace pf_pass1 {
using pf_bridge::registerInteraction;
${pass1.body}
} // namespace pf_pass1

${pass2 ? `namespace pf_pass2 {\n${pass2.body}\n} // namespace pf_pass2` : builtinPass2Checker(settings)}

int main(int argc, char* argv[]) {
    std::signal(SIGPIPE, SIG_IGN);
    const char* env_pass = std::getenv("HYDRO_MULTI_PASS");
    const std::string pass = env_pass ? env_pass : "";
    if (argc < 3) {
        std::fprintf(stderr, "FAIL expected Hydro interactor arguments\\n");
        return 3;
    }
    if (pass == "1") {
        if (!pf_bridge::read_file_bytes(argv[1], pf_bridge::orig_inf_bytes)) {
            std::fprintf(stderr, "FAIL cannot read original test input\\n");
            return 3;
        }
        pf_bridge::tout_path = argv[2];
        pf_bridge::real_stdout_fd = ::dup(STDOUT_FILENO);
        pf_bridge::real_stdin_fd = ::dup(STDIN_FILENO);
        int tmp_fd = ::open(".pf_pass1_out.bin", O_CREAT | O_TRUNC | O_WRONLY, 0600);
        if (pf_bridge::real_stdout_fd < 0 || pf_bridge::real_stdin_fd < 0 || tmp_fd < 0) {
            std::fprintf(stderr, "FAIL cannot initialize pass-1 buffer\\n");
            return 3;
        }
        if (::dup2(tmp_fd, STDOUT_FILENO) < 0) {
            std::fprintf(stderr, "FAIL cannot redirect pass-1 stdout\\n");
            return 3;
        }
        ::close(tmp_fd);
        ::on_exit(pf_bridge::on_pass1_exit, nullptr);
        return pf_pass1::pf_main(argc, argv);
    }
    if (pass != "2") {
        std::fprintf(stderr, "FAIL expected HYDRO_MULTI_PASS=1 or 2\\n");
        return 3;
    }

    std::ifstream next_in(argv[1], std::ios::binary);
    std::string magic;
    size_t orig_len = 0, pass2_len = 0;
    if (!next_in || !std::getline(next_in, magic) || magic != "__PF_NEXTPASS_V1__" || !(next_in >> orig_len >> pass2_len)) {
        std::fprintf(stderr, "FAIL invalid nextpass.in header\\n");
        return 3;
    }
    if (next_in.get() != '\\n') {
        std::fprintf(stderr, "FAIL malformed nextpass.in separator\\n");
        return 3;
    }
    std::string orig_inf(orig_len, '\\0'), pass2_in(pass2_len, '\\0');
    if (orig_len && !next_in.read(&orig_inf[0], static_cast<std::streamsize>(orig_len))) {
        std::fprintf(stderr, "FAIL truncated original input in nextpass.in\\n");
        return 3;
    }
    if (pass2_len && !next_in.read(&pass2_in[0], static_cast<std::streamsize>(pass2_len))) {
        std::fprintf(stderr, "FAIL truncated pass-2 input in nextpass.in\\n");
        return 3;
    }
    if (!pf_bridge::write_file_bytes(".pf_orig.in", orig_inf)) {
        std::fprintf(stderr, "FAIL cannot materialize original input\\n");
        return 3;
    }
    if (!pf_bridge::send_phase_frame(STDOUT_FILENO, pass2_in)) {
        std::fprintf(stderr, "FAIL cannot send pass-2 input to contestant\\n");
        return 3;
    }
    std::string pass2_out;
    char buf[65536];
    for (;;) {
        ssize_t n = ::read(STDIN_FILENO, buf, sizeof(buf));
        if (n < 0) {
            if (errno == EINTR) continue;
            break;
        }
        if (n == 0) break;
        pass2_out.append(buf, static_cast<size_t>(n));
    }
    if (!pf_bridge::write_file_bytes(".pf_pass2.ouf", pass2_out)) {
        std::fprintf(stderr, "FAIL cannot materialize pass-2 output\\n");
        return 3;
    }
    std::string ans_path;
    if (argc >= 4) {
        ans_path = argv[3];
    } else {
        ans_path = ".pf_empty.ans";
        (void)pf_bridge::write_file_bytes(ans_path, "");
    }
    char arg0[] = "checker";
    std::vector<char> arg1_buf(std::string(".pf_orig.in").begin(), std::string(".pf_orig.in").end()); arg1_buf.push_back('\\0');
    std::vector<char> arg2_buf(std::string(".pf_pass2.ouf").begin(), std::string(".pf_pass2.ouf").end()); arg2_buf.push_back('\\0');
    std::vector<char> arg3_buf(ans_path.begin(), ans_path.end()); arg3_buf.push_back('\\0');
    char* fake_argv[5] = { arg0, arg1_buf.data(), arg2_buf.data(), arg3_buf.data(), nullptr };
    return pf_pass2::pf_main(4, fake_argv);
}
`;
}
