import { isCppLanguage, type ProgramLanguage, type ProgramRole } from '@problemforge/contracts';
import { programStarters } from './program-languages';

type SourceLanguage = 'CPP17' | 'C17' | 'JAVA17' | 'PYTHON3';
export type ProgramTemplate = {
  id: string; title: string; suggestedName: string; roles: ProgramRole[];
  description: string; tips: string[]; exampleLabel: string; example: string;
  sources: Partial<Record<SourceLanguage, string>>;
};
const solutions: ProgramRole[] = ['MAIN_SOLUTION', 'CORRECT_SOLUTION', 'WRONG_SOLUTION', 'TIME_LIMIT_SOLUTION', 'BRUTE_FORCE'];
export const programRoleGuides: Record<ProgramRole, string> = {
  MAIN_SOLUTION: '主标程用于生成参考答案，需通过全部必需数据。先确认实现正确，再用它生成答案。',
  CORRECT_SOLUTION: '正确解用于交叉验证，预期为 AC。建议与主标程采用不同实现。',
  WRONG_SOLUTION: '错误解用于检查数据能否识别某类错误。下面的示例只演示读写框架，请改成要测试的错误实现，并选择预期判定。',
  TIME_LIMIT_SOLUTION: '预期超时解用于检验数据强度。示例只演示读写框架，请填入复杂度过高的解法；至少应有一组数据触发 TLE。',
  BRUTE_FORCE: '暴力解用于小规模对拍。请在读写框架中实现直观、可靠的枚举算法，并让生成器控制数据规模。',
  GENERATOR: '生成器把测试输入写到标准输出。平台把种子追加为最后一个命令行参数，同时提供 PF_SEED 环境变量；相同参数和种子应生成相同数据。',
  VALIDATOR: 'Validator 检查测试输入是否合法，包括数值范围、空格、换行和文件结尾。使用 C++ 编译配置，平台已提供 testlib.h。',
  EXTRA_VALIDATOR: '额外 Validator 可针对小规模子任务增加约束。在「校验适用范围」选择全部数据或指定数据组；下面的数组示例可按该组要求缩小 n 的范围。',
  CHECKER: 'Checker 判断选手输出。testlib 中 inf 是测试输入，ouf 是选手输出，ans 是参考答案；用 _ok / _wa / _pe 返回通过、错误或格式错误。保存后在「判题配置」选择「自定义 testlib Checker」。',
  INTERACTOR: 'Interactor 与选手程序双向通信：inf 读取隐藏输入，ouf 读取选手回复，标准输出发送消息。每次发送后必须刷新，并用 quitf 明确结束判定。',
};

export const programTemplates: ProgramTemplate[] = [
  {
    id: 'solution-basic', title: '标准输入输出 · A+B', suggestedName: 'solution', roles: solutions,
    description: '读入两个整数并输出它们的和，用作解法的读写框架。',
    tips: ['按题意替换求和逻辑，并选择与代码一致的编译语言。', '本示例使用标准输入输出；若题目采用文件 I/O，需要按已保存文件名读写。'],
    exampleLabel: '示例', example: '输入：3 5\n输出：8',
    sources: {
      CPP17: String.raw`#include <iostream>
int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    long long a, b;
    if (!(std::cin >> a >> b)) return 0;
    // 按题意替换算法，必要时注意整数溢出。
    std::cout << a + b << '\n';
    return 0;
}
`,
      C17: String.raw`#include <stdio.h>
int main(void) {
    long long a, b;
    if (scanf("%lld%lld", &a, &b) != 2) return 0;
    /* 按题意替换算法，必要时注意整数溢出。 */
    printf("%lld\n", a + b);
    return 0;
}
`,
      JAVA17: String.raw`import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        if (!in.hasNextLong()) return;
        long a = in.nextLong(), b = in.nextLong();
        // 按题意替换算法；大量输入时改用缓冲读入。
        System.out.println(a + b);
    }
}
`,
      PYTHON3: String.raw`import sys

def main():
    data = sys.stdin.buffer.read().split()
    if not data:
        return
    a, b = map(int, data)
    # 按题意替换算法。
    print(a + b)

if __name__ == "__main__":
    main()
`,
    },
  },
  {
    id: 'generator-array', title: '生成器 · 随机整数数组', suggestedName: 'gen_array', roles: ['GENERATOR'],
    description: '生成两行输入：第一行是 n，第二行是 n 个 [1, maxValue] 内的随机整数。',
    tips: ['参数模式填写 n 和 maxValue，种子单独填写；命令模式最后一项是种子。', 'C++ 的 registerGen 会使用整组命令行参数（包含末尾种子）初始化随机数。Python 使用末尾种子。', '标准输出只写测试数据；调试信息写标准错误。不要使用当前时间初始化随机数。'],
    exampleLabel: '假设程序名为 gen_array：生成命令', example: 'gen_array 10 100 42',
    sources: {
      CPP17: String.raw`#include "testlib.h"
#include <iostream>
int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1); // 固定随机算法版本；参数和种子相同即可复现。
    ensuref(argc == 4, "usage: gen_array n maxValue seed");
    int n = opt<int>(1), maxValue = opt<int>(2);
    ensuref(1 <= n && n <= 200000, "n must be in [1, 200000]");
    ensuref(1 <= maxValue && maxValue <= 1000000000, "invalid maxValue");
    std::cout << n << '\n';
    for (int i = 0; i < n; ++i) {
        if (i) std::cout << ' ';
        std::cout << rnd.next(1, maxValue);
    }
    std::cout << '\n';
}
`,
      PYTHON3: String.raw`import random
import sys

def main():
    # 平台调用：程序 n maxValue seed，最后一个参数由种子字段追加。
    if len(sys.argv) != 4:
        raise SystemExit("usage: gen_array n maxValue seed")
    n, max_value, seed = map(int, sys.argv[1:])
    if not (1 <= n <= 200000 and 1 <= max_value <= 10**9):
        raise SystemExit("invalid n or maxValue")
    rng = random.Random(seed)  # 不使用当前时间作为种子。
    print(n)
    print(" ".join(str(rng.randint(1, max_value)) for _ in range(n)))

if __name__ == "__main__":
    main()
`,
    },
  },
  {
    id: 'generator-permutation', title: '生成器 · 随机排列', suggestedName: 'gen_perm', roles: ['GENERATOR'],
    description: '生成两行输入：第一行是 n，第二行是 1 到 n 的随机排列，每个数恰好出现一次。',
    tips: ['选择 C++ 编译配置，平台会提供 testlib.h。', '参数模式只填写 n；种子由平台追加，registerGen 会把它纳入随机初始化。'],
    exampleLabel: '假设程序名为 gen_perm：生成命令', example: 'gen_perm 10 42',
    sources: { CPP17: String.raw`#include "testlib.h"
#include <iostream>
int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);
    ensuref(argc == 3, "usage: gen_perm n seed");
    int n = opt<int>(1);
    ensuref(1 <= n && n <= 200000, "n must be in [1, 200000]");
    auto p = rnd.perm(n, 1); // 从 1 开始的排列。
    std::cout << n << '\n';
    for (int i = 0; i < n; ++i) {
        if (i) std::cout << ' ';
        std::cout << p[i];
    }
    std::cout << '\n';
}
` },
  },
  {
    id: 'validator-array', title: 'Validator · 整数数组与格式', suggestedName: 'validate_array', roles: ['VALIDATOR', 'EXTRA_VALIDATOR'],
    description: '检查两行数组输入：1 ≤ n ≤ 200000，1 ≤ a[i] ≤ 10⁹，并严格检查分隔符。',
    tips: ['输入从 inf 读取，不要输出答案。修改范围和额外条件以匹配题面。', 'readSpace / readEoln 检查空格和换行；最后调用 readEof 拒绝多余内容。', '保存后可在「工具自测」分别添加合法、越界、格式错误的输入，再执行「校验输入」。'],
    exampleLabel: '合法输入', example: '3\n1 2 3\n',
    sources: { CPP17: String.raw`#include "testlib.h"
int main(int argc, char* argv[]) {
    registerValidation(argc, argv);
    int n = inf.readInt(1, 200000, "n"); // 额外 Validator 可在此缩小规模。
    inf.readEoln();
    for (int i = 0; i < n; ++i) {
        if (i) inf.readSpace();
        inf.readInt(1, 1000000000, "a_i");
        // 更复杂的条件可保存读入值，再用 ensuref(条件, "错误说明") 检查。
    }
    inf.readEoln();
    inf.readEof(); // 不允许额外的行或字符。
}
` },
  },
  {
    id: 'checker-integer', title: 'Checker · 单个整数答案', suggestedName: 'check_integer', roles: ['CHECKER'],
    description: '要求选手输出一个整数，与参考答案相同，并拒绝多余内容。',
    tips: ['registerTestlibCmd 由平台传入三个文件：输入、选手输出、参考答案，不需要手工填写路径。', '普通整数比较也可直接使用平台内置比较器；本例用于学习自定义 Checker 的接口。', '在「工具自测」同时填写输入、参考答案和待检输出，测试 AC / WA / PE。'],
    exampleLabel: '自测示例', example: '参考答案：8\n待检输出：8 → AC；9 → WA；8 extra → PE',
    sources: { CPP17: String.raw`#include "testlib.h"
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    // inf：题目输入；ouf：选手输出；ans：参考答案。
    long long expected = ans.readLong();
    long long actual = ouf.readLong();
    if (!ouf.seekEof()) quitf(_pe, "unexpected extra output");
    if (actual != expected)
        quitf(_wa, "expected %lld, found %lld", expected, actual);
    quitf(_ok, "correct integer");
}
` },
  },
  {
    id: 'checker-construction', title: 'Checker · 多解构造题', suggestedName: 'check_split', roles: ['CHECKER'],
    description: '示例题：输入 n，选手输出两个非负整数 a、b，满足 a+b=n。多种输出都可以正确。',
    tips: ['从 inf 读取约束，验证 ouf 中构造的合法性；本例不需要读取 ans。', '构造题通常不能逐字比较参考答案。既要检查答案性质，也要检查范围和多余输出。'],
    exampleLabel: '自测示例', example: '输入：10；参考答案：5 5\n待检输出：3 7 → AC；3 6 → WA',
    sources: { CPP17: String.raw`#include "testlib.h"
int main(int argc, char* argv[]) {
    registerTestlibCmd(argc, argv);
    long long n = inf.readLong(0LL, 1000000000LL, "n");
    long long a = ouf.readLong(0LL, n, "a");
    long long b = ouf.readLong(0LL, n, "b");
    if (!ouf.seekEof()) quitf(_pe, "unexpected extra output");
    if (a + b != n) quitf(_wa, "a+b must equal %lld", n);
    // 只验证构造合法性，允许与参考答案不同。
    quitf(_ok, "valid construction");
}
` },
  },
  {
    id: 'interactor-double', title: 'Interactor · 一问一答', suggestedName: 'interact_double', roles: ['INTERACTOR'],
    description: '示例协议：隐藏输入为 n，交互器发送 n，选手应回复 2n。',
    tips: ['在「判题配置」启用「双向交互」，本例采用 Interactor 直接判定。', 'cout 发送给选手，必须 endl 或 flush；ouf 读取选手的标准输出，inf 读取隐藏输入。', '使用非样例数据作为隐藏输入；在主标程中可选「交互解法 · 回答两倍」作为配套示例。'],
    exampleLabel: '一轮通信', example: '隐藏输入：7\nInteractor → 选手：7\n选手 → Interactor：14 → AC',
    sources: { CPP17: String.raw`#include "testlib.h"
#include <iostream>
int main(int argc, char* argv[]) {
    registerInteraction(argc, argv);
    int n = inf.readInt(1, 1000000, "n");
    std::cout << n << std::endl; // 发送并刷新，否则双方可能一直等待。
    long long reply = ouf.readLong(); // 读取选手回复。
    if (reply != 2LL * n) quitf(_wa, "expected %d, found %lld", 2 * n, reply);
    tout << reply << std::endl; // 记录结果，区别于发给选手的 cout。
    quitf(_ok, "correct reply");
}
` },
  },
  {
    id: 'solution-interactive', title: '交互解法 · 回答两倍', suggestedName: 'solution_interactive', roles: ['MAIN_SOLUTION', 'CORRECT_SOLUTION'],
    description: '与「Interactor · 一问一答」配套，收到 n 后立即回复 2n。',
    tips: ['先保存并启用配套 Interactor，再把判题配置设为双向交互。', '交互程序不要一次性读完整个标准输入；每次回答后刷新输出。'],
    exampleLabel: '协议示例', example: '收到：7\n回复并刷新：14',
    sources: {
      CPP17: String.raw`#include <iostream>
int main() {
    long long n;
    if (!(std::cin >> n)) return 0;
    std::cout << 2 * n << std::endl; // endl 会刷新输出。
    return 0;
}
`,
      PYTHON3: String.raw`# 每次只读取当前轮次，不要使用 sys.stdin.read() 等待整个输入结束。
n = int(input())
print(2 * n, flush=True)
`,
    },
  },
];

export function templateSource(template: ProgramTemplate, language: ProgramLanguage): string | undefined {
  return template.sources[isCppLanguage(language) ? 'CPP17' : language as SourceLanguage];
}
export function templatesFor(role: ProgramRole, language: ProgramLanguage) {
  return programTemplates.filter(template => template.roles.includes(role) && templateSource(template, language));
}
export function needsTemplateReplacementConfirmation(source: string, language: ProgramLanguage, saved: boolean) {
  return saved || !!source.trim() && source.trim() !== programStarters[language].trim();
}
