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
const FN_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const objectTag = (value) => Object.prototype.toString.call(value);
const isFunction = (value) => {
  const tag = objectTag(value);
  return (
    tag === "[object Function]" ||
    tag === "[object AsyncFunction]" ||
    tag === "[object GeneratorFunction]"
  );
};

const bindings = () => ({ prim: new Map() });

const takeImport = (b, node) => {
  if (node.source.value !== "ilha") {
    return;
  }
  for (const s of node.specifiers) {
    if (s.type !== "ImportSpecifier") {
      continue;
    }
    if (PRIMITIVES.has(s.imported.name)) {
      b.prim.set(s.local.name, s.imported.name);
    }
  }
};

const primitiveName = (node, b) => {
  if (node.type !== "CallExpression") {
    return null;
  }
  if (node.callee.type !== "Identifier") {
    return null;
  }
  return b.prim.get(node.callee.name) ?? null;
};

const ancestorsOf = (context, node) => {
  const sc = context.sourceCode;
  if (sc && isFunction(sc.getAncestors)) {
    return sc.getAncestors(node);
  }
  return [];
};

const blockBody = (node) => {
  if (node.type === "BlockStatement") {
    return node.body;
  }
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    const { body } = node;
    if (body?.type === "BlockStatement") {
      return body.body;
    }
  }
  return null;
};

const bindingInitType = (name, ancestors) => {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    if (
      a.type === "VariableDeclarator" &&
      a.id?.type === "Identifier" &&
      a.id.name === name
    ) {
      return a.init?.type ?? "none";
    }
    if (a.type === "FunctionDeclaration" && a.id?.name === name) {
      return "FunctionDeclaration";
    }
    const stmts = blockBody(a);
    if (stmts) {
      for (const stmt of stmts) {
        if (stmt.type !== "VariableDeclaration") {
          continue;
        }
        for (const decl of stmt.declarations) {
          if (decl.id?.type === "Identifier" && decl.id.name === name) {
            return decl.init?.type ?? "none";
          }
        }
      }
    }
  }
  return null;
};

const isFunctionBinding = (name, ancestors, moduleFns) => {
  const local = bindingInitType(name, ancestors);
  if (local === "FunctionDeclaration") {
    return true;
  }
  if (local !== null) {
    return FN_TYPES.has(local);
  }
  return moduleFns.has(name);
};

const enclosingFunctions = (ancestors) =>
  ancestors.filter((a) => FN_TYPES.has(a.type));

const noConditionalPrimitive = {
  create(context) {
    const b = bindings();
    return {
      CallExpression(node) {
        const name = primitiveName(node, b);
        if (!name) {
          return;
        }
        const ancestors = ancestorsOf(context, node);
        for (let i = ancestors.length - 1; i >= 0; i -= 1) {
          const a = ancestors[i];
          if (FN_TYPES.has(a.type)) {
            return;
          }
          if (CONDITIONAL.has(a.type)) {
            context.report({ data: { name }, messageId: "conditional", node });
            return;
          }
        }
      },
      ImportDeclaration(node) {
        takeImport(b, node);
      },
    };
  },
  meta: {
    docs: {
      description: "Disallow atom/watch/when inside conditionals or loops",
    },
    messages: {
      conditional:
        "Do not call {{name}}() inside a condition or loop. Primitive registration order must be stable — put the branch inside the primitive or the view.",
    },
    schema: [],
    type: "problem",
  },
};

const noPrimitiveOutsideComponent = {
  create(context) {
    const b = bindings();
    return {
      CallExpression(node) {
        const name = primitiveName(node, b);
        if (!name) {
          return;
        }
        const ancestors = ancestorsOf(context, node);
        if (enclosingFunctions(ancestors).length === 0) {
          context.report({ data: { name }, messageId: "outside", node });
        }
      },
      ImportDeclaration(node) {
        takeImport(b, node);
      },
    };
  },
  meta: {
    docs: {
      description:
        "Call atom/watch/when inside a component, never at module top level",
    },
    messages: {
      outside:
        "Call {{name}}() inside a component. There is no fiber at module scope, so this throws at runtime.",
    },
    schema: [],
    type: "problem",
  },
};

const noInstructionOutsideGenerator = {
  create(context) {
    const b = bindings();
    return {
      CallExpression(node) {
        const name = primitiveName(node, b);
        if (!name || !INSTRUCTIONS.has(name)) {
          return;
        }
        // yield* wraps the CallExpression in a YieldExpression.
        const parent = ancestorsOf(context, node).at(-1);
        if (parent?.type === "YieldExpression") {
          return;
        }
        const ancestors = ancestorsOf(context, node);
        const fns = enclosingFunctions(ancestors);
        const gen = fns.findLast((f) => f.generator === true);
        if (!gen) {
          context.report({ data: { name }, messageId: "notGenerator", node });
          return;
        }
        // Inside a generator body but not under a yield — the nearest function
        // between the call and the generator must not be a plain callback that
        // escapes the frame. If the call sits directly in the generator, require yield*.
        const genIdx = ancestors.indexOf(gen);
        const between = ancestors
          .slice(genIdx + 1)
          .filter((a) => FN_TYPES.has(a.type));
        if (between.length === 0) {
          context.report({ data: { name }, messageId: "notYielded", node });
        }
      },
      ImportDeclaration(node) {
        takeImport(b, node);
      },
    };
  },
  meta: {
    docs: { description: "Use when only inside a generator, with yield*" },
    messages: {
      notGenerator:
        "{{name}}() returns an instruction that only a generator frame can run. Make the enclosing component a generator and yield* it.",
      notYielded:
        "Call yield* with {{name}}() — calling it directly discards the instruction.",
    },
    schema: [],
    type: "problem",
  },
};

const preferLowercaseEvents = {
  create(context) {
    const checkName = (node, name) => {
      if (/^on[A-Z]/u.test(name)) {
        context.report({
          data: { name, suggested: `on${name.slice(2).toLowerCase()}` },
          messageId: "camel",
          node,
        });
      }
    };
    return {
      JSXAttribute(node) {
        if (node.name.type === "JSXIdentifier") {
          checkName(node.name, node.name.name);
        }
        if (node.name.type === "JSXNamespacedName") {
          checkName(node.name.namespace, node.name.namespace.name);
        }
      },
      // Selector reserved for future property-value checks; keep registered.
      "Property[value.type=/Function(Expression|Declaration)$/], Property[value.type='ArrowFunctionExpression']"() {
        void 0;
      },
    };
  },
  meta: {
    docs: {
      description: "Use lowercase DOM event props (onclick, not onClick)",
    },
    messages: {
      camel: 'Use lowercase event "{{suggested}}" instead of "{{name}}".',
    },
    schema: [],
    type: "problem",
  },
};

const functionInAtom = {
  create(context) {
    const b = bindings();
    const fns = new Set();
    return {
      CallExpression(node) {
        if (node.arguments.length === 0) {
          return;
        }
        const [arg] = node.arguments;
        if (arg.type !== "Identifier") {
          return;
        }
        if (
          primitiveName(node, b) === "atom" &&
          isFunctionBinding(arg.name, ancestorsOf(context, arg), fns)
        ) {
          context.report({
            data: { name: arg.name },
            messageId: "init",
            node: arg,
          });
        }
      },
      FunctionDeclaration(node) {
        if (node.id) {
          fns.add(node.id.name);
        }
      },
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier") {
          return;
        }
        const { init } = node;
        if (
          init &&
          (init.type === "FunctionExpression" ||
            init.type === "ArrowFunctionExpression")
        ) {
          fns.add(node.id.name);
        }
        if (!init || primitiveName(init, b) !== "atom") {
          return;
        }
        const [arg] = init.arguments;
        if (arg && FN_TYPES.has(arg.type)) {
          context.report({ messageId: "derived", node: arg });
        }
        if (
          arg?.type === "Identifier" &&
          isFunctionBinding(arg.name, ancestorsOf(context, arg), fns)
        ) {
          context.report({
            data: { name: arg.name },
            messageId: "init",
            node: arg,
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "atom(fn) and atom(() => …) are invalid — use atom.lazy, Atom.map, or Atom.transform",
    },
    messages: {
      derived:
        "atom(() => …) is not supported. Use atom(Atom.map(...)) or atom(Atom.transform(...)) for derived values, or atom.lazy() for one-time init.",
      init: "atom({{name}}) is not valid. Use atom.lazy(() => {{name}}) to store a function value.",
    },
    schema: [],
    type: "problem",
  },
};

module.exports = {
  meta: { name: "oxlint-plugin-ilha" },
  rules: {
    "function-in-atom": functionInAtom,
    "no-conditional-primitive": noConditionalPrimitive,
    "no-instruction-outside-generator": noInstructionOutsideGenerator,
    "no-primitive-outside-component": noPrimitiveOutsideComponent,
    "prefer-lowercase-events": preferLowercaseEvents,
  },
};
