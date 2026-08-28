/**
 * `@freeforever/design-system/eslint`
 *
 * The mechanical half of ADR-0021: six teams building UI in parallel will produce
 * six slightly different greys unless something fails the build.
 *
 * Flat config (eslint.config.js at the repo root):
 *
 *   import freeforever from "@freeforever/design-system/eslint";
 *
 *   export default [
 *     ...freeforever.configs.recommended,
 *   ];
 *
 * Or wire the rule yourself:
 *
 *   {
 *     plugins: { freeforever },
 *     rules: { "freeforever/no-raw-literals": "error" },
 *   }
 */
import { DEFAULT_IGNORED_PATHS, findRawLiterals } from './detect.js';

/** @type {import('eslint').Rule.RuleModule} */
const noRawLiterals = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hex colours, raw px lengths and raw durations outside packages/design-system (ADR-0021).',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Extra regex sources that are allowed to contain raw values. */
          allow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawLiteral:
        'Raw {{kind}} literal "{{value}}" (ADR-0021: no raw literals outside the design system). Instead, {{suggestion}}.',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();

    // The design system is the one place these values are allowed to exist.
    if (DEFAULT_IGNORED_PATHS.some((pattern) => pattern.test(filename))) return {};

    const configured = context.options[0]?.allow ?? [];
    const allow = configured.map((source) => new RegExp(source));

    /**
     * Is this literal in a position where only a style value could sensibly appear?
     * A `style` prop, an object literal under one, or a tagged template (CSS-in-JS).
     * @param {any} node
     */
    const inStyleContext = (node) => {
      let current = node.parent;
      let depth = 0;
      while (current && depth < 6) {
        if (current.type === 'JSXAttribute' && current.name?.name === 'style') return true;
        if (current.type === 'TaggedTemplateExpression') return true;
        if (
          current.type === 'Property' &&
          (current.key?.name === 'style' || current.key?.value === 'style')
        ) {
          return true;
        }
        current = current.parent;
        depth += 1;
      }
      return false;
    };

    /**
     * @param {any} node
     * @param {string} text
     */
    const check = (node, text) => {
      for (const hit of findRawLiterals(text, { allow, styleContext: inStyleContext(node) })) {
        context.report({
          node,
          messageId: 'rawLiteral',
          data: { kind: hit.kind, value: hit.value, suggestion: hit.suggestion },
        });
      }
    };

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      JSXText(node) {
        // Visible copy can legitimately say "5px" - only flag it in an attribute.
        void node;
      },
    };
  },
};

const plugin = {
  meta: { name: '@freeforever/design-system', version: '0.0.0' },
  rules: { 'no-raw-literals': noRawLiterals },
};

plugin.configs = {
  recommended: [
    {
      name: 'freeforever/no-raw-literals',
      // JS/TS only: ESLint's default parser cannot read .css. Stylesheets outside the
      // design system are covered by the fact that feature teams do not write any -
      // they consume tokens and primitive class names.
      files: ['**/*.{js,jsx,ts,tsx}'],
      ignores: ['packages/design-system/**'],
      plugins: { freeforever: plugin },
      rules: { 'freeforever/no-raw-literals': 'error' },
    },
  ],
};

export default plugin;
export { noRawLiterals, findRawLiterals };
