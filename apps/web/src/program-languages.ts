import type { ProgramLanguage } from '@problemforge/contracts';

const cpp = '#include <iostream>\nint main() {\n  // 编写程序\n}\n';
export const programStarters: Record<ProgramLanguage, string> = {
  CPP17: cpp, CPP20: cpp, CPP23: cpp,
  C17: '#include <stdio.h>\nint main(void) {\n  // 编写程序\n  return 0;\n}\n',
  JAVA17: 'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n  public static void main(String[] args) throws Exception {\n    // 编写程序\n  }\n}\n',
  PYTHON3: '# 编写程序\n',
};
export const programEditorLanguages: Record<ProgramLanguage, string> = { CPP17: 'cpp', CPP20: 'cpp', CPP23: 'cpp', C17: 'c', JAVA17: 'java', PYTHON3: 'python' };
