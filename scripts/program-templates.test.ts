import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programStarters } from '../apps/web/src/program-languages.ts';
import { needsTemplateReplacementConfirmation, templatesFor, templateSource } from '../apps/web/src/program-templates.ts';

test('template insertion requires confirmation for saved programs and authored drafts', () => {
  assert.equal(needsTemplateReplacementConfirmation('', 'CPP17', false), false);
  assert.equal(needsTemplateReplacementConfirmation(programStarters.CPP17, 'CPP17', false), false);
  assert.equal(needsTemplateReplacementConfirmation(programStarters.CPP17 + '// my changes', 'CPP17', false), true);
  assert.equal(needsTemplateReplacementConfirmation(programStarters.PYTHON3, 'CPP17', false), true);
  assert.equal(needsTemplateReplacementConfirmation(programStarters.CPP17, 'CPP17', true), true);
  assert.equal(needsTemplateReplacementConfirmation('', 'PYTHON3', true), true);
});

test('role and compiler language select compatible source without silently switching profiles', () => {
  for (const language of ['CPP17', 'CPP20', 'CPP23'] as const) {
    assert.equal(templatesFor('CHECKER', language).length, 2);
    assert.ok(templateSource(templatesFor('GENERATOR', language)[0], language)?.includes('registerGen'));
  }
  for (const language of ['C17', 'JAVA17', 'PYTHON3'] as const) assert.deepEqual(templatesFor('CHECKER', language), []);
  assert.ok(templateSource(templatesFor('GENERATOR', 'PYTHON3')[0], 'PYTHON3')?.includes('random.Random(seed)'));
  assert.equal(templatesFor('EXTRA_VALIDATOR', 'CPP17')[0].id, 'validator-array');
  assert.equal(templatesFor('INTERACTOR', 'CPP17')[0].id, 'interactor-double');
});
