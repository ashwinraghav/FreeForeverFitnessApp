import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import freeforever from '@freeforever/design-system/eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Root lint config.
 *
 * This file exists late and that is itself the finding: `pnpm lint` ran in two CI
 * jobs and had never linted anything, because eslint was not installed and no
 * config existed. Three ADRs claimed enforcement here that did not exist. A check
 * reported as passing while doing nothing is worse than no check.
 *
 * The three rules below are the mechanical halves of decisions that were, until
 * now, upheld only by people remembering them.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      '**/*.d.ts',
      'packages/datasets/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      // The `_` prefix is this codebase's existing convention for "deliberately
      // unused" — teams use it in destructuring to skip fields. Honour it
      // everywhere, not just on arguments, or the rule punishes the convention
      // it should be reinforcing.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ---------------------------------------------------------------------------
  // ADR-0021 — no raw colour, spacing or duration literals outside the design
  // system. Six teams building UI in parallel produce six slightly different
  // greys unless something fails the build.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { freeforever },
    rules: { 'freeforever/no-raw-literals': 'error' },
  },

  // Two places a raw colour is the correct thing to write, so the rule would be
  // asserting a falsehood if it fired here:
  //
  //   - Build config. The PWA manifest's theme_color ends up in generated JSON,
  //     which cannot reference a CSS custom property. The literal IS the value.
  //   - Palette tests. A test asserting that a token equals #0A1119 has to name
  //     #0A1119, or it is asserting a variable against itself.
  //
  // Narrow exemptions, not a blanket off — a rule with vague carve-outs stops
  // being believed.
  {
    files: ['**/*.config.{ts,js,mjs}', '**/test/palette.test.ts', '**/*.tokens.test.ts'],
    rules: { 'freeforever/no-raw-literals': 'off' },
  },

  // Accessibility is a stated contract (ADR-0013), so the lint tier for it should
  // exist rather than being asserted only in tests. Also resolves an
  // eslint-disable in ScanScreen.tsx that referenced a rule from a plugin this
  // repo never installed — the disable comment was written in good faith against
  // a linter that was not running.
  {
    files: ['apps/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,

      // no-autofocus is off, deliberately and narrowly reasoned.
      //
      // The rule guards against autofocus on page load, which moves focus
      // somewhere the user did not ask for and disorients screen-reader and
      // cognitively-impaired users. Every use in this app is the opposite case:
      // the field is rendered *because* the user tapped that value to edit it,
      // so focus follows their own explicit action to the thing they just
      // chose. Not focusing it would strand them one tap short of the reason
      // they tapped.
      //
      // That matters more here than in most apps. The brief is one chalky hand,
      // out of breath, interrupted every ninety seconds (ADR-0013), and a set is
      // edited roughly forty times a session. A mandatory second tap is a real
      // accessibility cost for people with motor difficulty, not a saving.
      //
      // The rule stays off only for this pattern. Autofocus on mount, on a
      // route, or on anything the user did not just open is still wrong — and
      // there is no linter for that, so it is on reviewers.
      'jsx-a11y/no-autofocus': 'off',

      // `role="list"` on a `<ul>` is redundant markup and normally noise — but
      // VoiceOver in Safari strips list semantics from a list styled
      // `list-style: none`, which is every horizontal strip in this app. This is
      // a phone-first PWA (ADR-0008), so iOS Safari is the browser that decides
      // whether a blind user hears "list, 3 items" or nothing at all. The
      // redundancy is load-bearing, so allow it for `ul` specifically rather
      // than accepting a disable comment on every list.
      'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'] }],
    },
  },

  // ---------------------------------------------------------------------------
  // ADR-0026 — the licence split is a dependency constraint.
  //
  // packages/core and packages/design-system are Apache-2.0 so they stay
  // reusable; packages/data and the apps are AGPL. An AGPL import places the
  // Apache package's distribution under the AGPL — a licence change wearing an
  // import's clothes.
  //
  // This nearly shipped: the integrator asked the workout team to import
  // isVolumeEligible from @freeforever/data into packages/core, and it was
  // caught only because a person knew the licences. That is exactly the kind of
  // guarantee that belongs in a rule rather than in someone's memory.
  // ---------------------------------------------------------------------------
  {
    files: ['packages/core/**/*.ts', 'packages/design-system/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@freeforever/data', '@freeforever/data/*', '@freeforever/web'],
              message:
                'ADR-0026: this package is Apache-2.0 and must not depend on an AGPL one. ' +
                'Restate what you need and prove equivalence in a package that depends on both.',
            },
          ],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // ADR-0005 / ADR-0025 — all application writes go through the sync engine.
  //
  // A pending offline write carries an unresolved serverTimestamp() sentinel
  // that reads locally as null, so the delta listener cannot see the device's
  // own writes. Feature code calling Firestore directly gets charts that
  // silently lag until reconnect, and no conflict recovery. The write layer
  // hands documents to the aggregate engine at the moment of the tap; bypassing
  // it is not a style question.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/data/src/!(sync)/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'firebase/firestore',
              importNames: ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'],
              message:
                'ADR-0005: write through the sync engine (engine.writeContext()), not Firestore directly. ' +
                'A direct write is invisible to the delta listener until the server acks, so aggregates lag ' +
                'and conflict recovery never runs.',
            },
          ],
        },
      ],
    },
  },

  // Tests may reach for things application code may not.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**', '**/__tests__/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
