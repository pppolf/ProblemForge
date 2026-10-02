import { isCppLanguage, type ProgramLanguage, type ProfileConfigValue } from '@problemforge/contracts';

export function compilePlan(language: ProgramLanguage, profile: ProfileConfigValue) {
  if (language === 'PYTHON3') return { source: 'source.py', artifact: 'source.py', args: ['/usr/bin/python3', '-I', '-m', 'py_compile', 'source.py'] };
  if (language === 'JAVA17') return { source: 'Main.java', artifact: 'program.jar', args: ['/usr/local/bin/pf-javac17', String(Math.max(32, Math.floor(profile.compileMemoryMb * 0.75))), profile.warnings ? 'all' : 'none'] };
  if (language === 'C17' || isCppLanguage(language)) {
    const source = language === 'C17' ? 'source.c' : 'source.cpp';
    const standard = { C17: 'c17', CPP17: 'c++17', CPP20: 'c++20', CPP23: 'c++23' }[language as 'C17' | 'CPP17' | 'CPP20' | 'CPP23'];
    return { source, artifact: 'program', args: [language === 'C17' ? '/usr/bin/gcc' : '/usr/bin/g++', `-std=${standard}`, `-${profile.optimization}`, '-pipe', ...(profile.warnings ? ['-Wall', '-Wextra'] : []), source, '-o', 'program', ...(language === 'C17' ? ['-lm'] : [])] };
  }
  throw new Error('Unsupported fixed program language');
}

export function runtimeArgs(language: ProgramLanguage, artifact: string, argv: string[], memoryMb: number) {
  if (language === 'JAVA17') return ['/usr/bin/java', '-Xms16m', `-Xmx${memoryMb}m`, '-Xss1m', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=1', '-XX:ReservedCodeCacheSize=32m', '-XX:-UsePerfData', '-Dfile.encoding=UTF-8', '-jar', `/w/${artifact}`, ...argv];
  if (language === 'PYTHON3') return ['/usr/bin/python3', '-I', '-B', `/w/${artifact}`, ...argv];
  if (language === 'C17' || isCppLanguage(language)) return [`/w/${artifact}`, ...argv];
  throw new Error('Unsupported fixed program language');
}
