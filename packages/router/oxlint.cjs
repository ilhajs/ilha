const PRIMITIVES = new Set(["atom", "watch", "when"]);
const INSTRUCTIONS = new Set(["when"]);
const CONDITIONAL = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
  "ConditionalExpression",
  "LogicalExpression",
]);
const FN_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function bindings() {
  return { prim: new Map() };
}

function takeImport(b, node) {
  if (node.source.value !== "ilha") return;
  for (const s of node.specifiers) {
    if (s.type !== "ImportSpecifier") continue;
    if (PRIMITIVES.has(s.imported.name)) b.prim.set(s.local.name, s.imported.name);
  }
}

function primitiveName(node, b) {
  if (node.type !== "CallExpression") return null;
  if (node.callee.type !== "Identifier") return null;
  return b.prim.get(node.callee.name) ?? null;
}

function ancestorsOf(context, node) {
  const sc = context.sourceCode;
  if (sc && typeof sc.getAncestors === "function") return sc.getAncestors(node);
  return [];
}

function enclosingFunctions(ancestors) {
  return ancestors.filter((a) => FN_TYPES.has(a.type));
}

const noConditionalPrimitive = {
  meta: {
    type: "problem",
    docs: { description: "Disallow atom/watch/when inside conditionals or loops" },
    messages: {
      conditional:
        "Do not call {{name}}() inside a condition or loop. Primitive registration order must be stable — put the branch inside the primitive or the view.",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      CallExpression(node) {
        const name = primitiveName(node, b);
        if (!name) return;
        const ancestors = ancestorsOf(context, node);
        for (let i = ancestors.length - 1; i >= 0; i--) {
          const a = ancestors[i];
          if (FN_TYPES.has(a.type)) return;
          if (CONDITIONAL.has(a.type)) {
            context.report({ node, messageId: "conditional", data: { name } });
            return;
          }
        }
      },
    };
  },
};

const noPrimitiveOutsideComponent = {
  meta: {
    type: "problem",
    docs: {
      description: "Call atom/watch/when inside a component, never at module top level",
    },
    messages: {
      outside:
        "Call {{name}}() inside a component. There is no fiber at module scope, so this throws at runtime.",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      CallExpression(node) {
        const name = primitiveName(node, b);
        if (!name) return;
        const ancestors = ancestorsOf(context, node);
        if (enclosingFunctions(ancestors).length === 0) {
          context.report({ node, messageId: "outside", data: { name } });
        }
      },
    };
  },
};

const noInstructionOutsideGenerator = {
  meta: {
    type: "problem",
    docs: { description: "Use when only inside a generator, with yield*" },
    messages: {
      notGenerator:
        "{{name}}() returns an instruction that only a generator frame can run. Make the enclosing component a generator and yield* it.",
      notYielded: "Call yield* with {{name}}() — calling it directly discards the instruction.",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      CallExpression(node) {
        const name = primitiveName(node, b);
        if (!name || !INSTRUCTIONS.has(name)) return;
        // yield* wraps the CallExpression in a YieldExpression.
        const parent = ancestorsOf(context, node).at(-1);
        if (parent?.type === "YieldExpression") return;
        const ancestors = ancestorsOf(context, node);
        const fns = enclosingFunctions(ancestors);
        const gen = fns.findLast((f) => f.generator === true);
        if (!gen) {
          context.report({ node, messageId: "notGenerator", data: { name } });
          return;
        }
        // Inside a generator body but not under a yield — the nearest function
        // between the call and the generator must not be a plain callback that
        // escapes the frame. If the call sits directly in the generator, require yield*.
        const genIdx = ancestors.indexOf(gen);
        const between = ancestors.slice(genIdx + 1).filter((a) => FN_TYPES.has(a.type));
        if (between.length === 0) {
          context.report({ node, messageId: "notYielded", data: { name } });
        }
      },
    };
  },
};

const preferLowercaseEvents = {
  meta: {
    type: "problem",
    docs: { description: "Use lowercase DOM event props (onclick, not onClick)" },
    messages: {
      camel: 'Use lowercase event "{{suggested}}" instead of "{{name}}".',
    },
    schema: [],
  },
  create(context) {
    function checkName(node, name) {
      if (/^on[A-Z]/.test(name)) {
        context.report({
          node,
          messageId: "camel",
          data: { name, suggested: `on${name.slice(2).toLowerCase()}` },
        });
      }
    }
    return {
      JSXAttribute(node) {
        if (node.name.type === "JSXIdentifier") checkName(node.name, node.name.name);
        if (node.name.type === "JSXNamespacedName") {
          checkName(node.name.namespace, node.name.namespace.name);
        }
      },
      "Property[value.type=/Function(Expression|Declaration)$/], Property[value.type='ArrowFunctionExpression']"() {},
    };
  },
};

const functionInAtom = {
  meta: {
    type: "problem",
    docs: {
      description:
        "atom(fn) and atom(() => …) are invalid — use atom.lazy, Atom.map, or Atom.transform",
    },
    messages: {
      init: "atom({{name}}) is not valid. Use atom.lazy(() => {{name}}) to store a function value.",
      derived:
        "atom(() => …) is not supported. Use atom(Atom.map(...)) or atom(Atom.transform(...)) for derived values, or atom.lazy() for one-time init.",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    const fns = new Set();
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      FunctionDeclaration(node) {
        if (node.id) fns.add(node.id.name);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier") return;
        const init = node.init;
        if (
          init &&
          (init.type === "FunctionExpression" || init.type === "ArrowFunctionExpression")
        ) {
          fns.add(node.id.name);
        }
        if (!init || primitiveName(init, b) !== "atom") return;
        if (init.arguments[0] && FN_TYPES.has(init.arguments[0].type)) {
          context.report({ node: init.arguments[0], messageId: "derived" });
        }
      },
      CallExpression(node) {
        if (node.arguments.length === 0) return;
        const arg = node.arguments[0];
        if (arg.type !== "Identifier" || !fns.has(arg.name)) return;
        if (primitiveName(node, b) === "atom") {
          context.report({ node: arg, messageId: "init", data: { name: arg.name } });
        }
      },
    };
  },
};

module.exports = {
  meta: { name: "oxlint-plugin-ilha" },
  rules: {
    "no-conditional-primitive": noConditionalPrimitive,
    "no-primitive-outside-component": noPrimitiveOutsideComponent,
    "no-instruction-outside-generator": noInstructionOutsideGenerator,
    "prefer-lowercase-events": preferLowercaseEvents,
    "function-in-atom": functionInAtom,
  },
};
