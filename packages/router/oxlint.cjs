const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const PRIMITIVES = new Set(["state", "derived", "action", "effect", "onError"]);
const ACTION_STATUS = new Set(["pending", "data", "error"]);
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
  return { ilha: new Set(["ilha"]), prim: new Map() };
}

function takeImport(b, node) {
  if (node.source.value !== "ilha") return;
  for (const s of node.specifiers) {
    if (s.type !== "ImportSpecifier") continue;
    const imported = s.imported.name;
    const local = s.local.name;
    if (imported === "ilha") {
      b.ilha.add(local);
    }
    if (PRIMITIVES.has(imported)) b.prim.set(local, imported);
  }
}

function isIlhaCall(node, b) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    b.ilha.has(node.callee.name)
  );
}

function primitiveName(node, b) {
  if (node.type !== "CallExpression") return null;
  const c = node.callee;
  if (c.type === "Identifier") return b.prim.get(c.name) ?? null;
  const effectLocal = [...b.prim].find(([, n]) => n === "effect")?.[0];
  if (
    effectLocal &&
    c.type === "MemberExpression" &&
    !c.computed &&
    c.object.type === "Identifier" &&
    c.object.name === effectLocal &&
    c.property.type === "Identifier" &&
    c.property.name === "once"
  ) {
    return "effect.once";
  }
  return null;
}

function fnName(node, parent) {
  if (node.id && node.id.type === "Identifier") return node.id.name;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  return "";
}

function isComponentFn(node, parent, ancestors, b) {
  const name = fnName(node, parent);
  if (PASCAL_CASE.test(name)) return true;
  if (parent?.type === "CallExpression" && isIlhaCall(parent, b)) return true;
  const grand = ancestors?.[ancestors.length - 2];
  return !!(grand && isIlhaCall(grand, b));
}

function ancestorsOf(context, node) {
  const sc = context.sourceCode;
  if (sc && typeof sc.getAncestors === "function") return sc.getAncestors(node);
  return [];
}

function parentOf(context, node) {
  const a = ancestorsOf(context, node);
  return a[a.length - 1];
}

function toPascalCase(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function calleeName(node) {
  return node.type === "Identifier" ? node.name : null;
}

function collectIslands(b) {
  const names = new Set();
  return {
    names,
    VariableDeclarator(node) {
      if (node.id.type === "Identifier" && node.init && isIlhaCall(node.init, b)) {
        names.add(node.id.name);
      }
    },
  };
}

function isInsideComponent(context, node, b) {
  const ancestors = ancestorsOf(context, node);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (!FN_TYPES.has(a.type)) continue;
    const parent = i > 0 ? ancestors[i - 1] : null;
    if (isComponentFn(a, parent, ancestors.slice(0, i), b)) return true;
  }
  return false;
}

function islandCallee(names, callee) {
  if (callee.type === "Identifier" && names.has(callee.name)) return callee.name;
  return null;
}

const pascalCase = {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Enforce PascalCase for ilha island variable names" },
    messages: {
      notPascalCase: 'Island variable "{{name}}" must be PascalCase (e.g. "{{suggested}}").',
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init && isIlhaCall(node.init, b)) {
          const name = node.id.name;
          if (!PASCAL_CASE.test(name)) {
            const suggested = toPascalCase(name);
            context.report({
              node: node.id,
              messageId: "notPascalCase",
              data: { name, suggested },
              fix(fixer) {
                return fixer.replaceText(node.id, suggested);
              },
            });
          }
        }
      },
    };
  },
};

const noConditionalPrimitive = {
  meta: {
    type: "problem",
    docs: { description: "Disallow primitives inside conditionals or loops" },
    messages: {
      conditional:
        "Do not call {{name}}() inside a condition or loop. Put the branch inside the primitive.",
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

const noPrimitiveOutsideIsland = {
  meta: {
    type: "problem",
    docs: { description: "Only call primitives in an island render or PascalCase component" },
    messages: {
      outside:
        "Call {{name}}() only in an ilha() render or a PascalCase component. Put setup in effect.once().",
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
        const fns = ancestors.filter((a) => FN_TYPES.has(a.type));
        if (fns.length === 0) {
          context.report({ node, messageId: "outside", data: { name } });
          return;
        }
        const enclosing = fns[fns.length - 1];
        const idx = ancestors.indexOf(enclosing);
        const parent = idx > 0 ? ancestors[idx - 1] : parentOf(context, enclosing);
        if (isComponentFn(enclosing, parent, ancestors.slice(0, idx), b)) return;
        context.report({ node, messageId: "outside", data: { name } });
      },
    };
  },
};

const preferPlainHandler = {
  meta: {
    type: "suggestion",
    docs: { description: "Use a plain function unless action status or cancellation is used" },
    messages: {
      unused:
        "action() is unused as a status object. Use a plain function unless you read .pending, .data, or .error.",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    const found = new Map();
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !node.init) return;
        if (primitiveName(node.init, b) !== "action") return;
        found.set(node.id.name, { node: node.init, used: false });
      },
      MemberExpression(node) {
        if (node.computed || node.object.type !== "Identifier") return;
        if (node.property.type !== "Identifier" || !ACTION_STATUS.has(node.property.name)) return;
        const rec = found.get(node.object.name);
        if (rec) rec.used = true;
      },
      "Program:exit"() {
        for (const rec of found.values()) {
          if (!rec.used) context.report({ node: rec.node, messageId: "unused" });
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
          data: { name, suggested: "on" + name.slice(2).toLowerCase() },
        });
      }
    }
    return {
      JSXAttribute(node) {
        const parent = parentOf(context, node);
        const tag = parent && parent.name;
        if (tag && tag.type === "JSXIdentifier" && PASCAL_CASE.test(tag.name)) return;
        if (node.name.type === "JSXIdentifier") checkName(node.name, node.name.name);
        if (node.name.type === "JSXNamespacedName") {
          checkName(node.name.namespace, node.name.namespace.name);
        }
      },
      TaggedTemplateExpression(node) {
        if (node.tag.type !== "Identifier" || node.tag.name !== "html") return;
        for (const q of node.quasi.quasis) {
          const text = q.value.cooked ?? q.value.raw;
          const re = /\bon[A-Z][A-Za-z]*/g;
          let m;
          while ((m = re.exec(text))) checkName(node, m[0]);
        }
      },
    };
  },
};

const noDirectIslandCall = {
  meta: {
    type: "problem",
    docs: { description: "Only call islands as children inside another island render" },
    messages: {
      direct:
        "Do not call {{name}}() here. Nest it inside another island, or use {{name}}.toString / toStringAsync / hydratable.",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    const { names, VariableDeclarator } = collectIslands(b);
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      VariableDeclarator,
      CallExpression(node) {
        const name = islandCallee(names, node.callee);
        if (!name) return;
        if (isInsideComponent(context, node, b)) return;
        context.report({ node, messageId: "direct", data: { name } });
      },
    };
  },
};

const requireSsrApi = {
  meta: {
    type: "problem",
    docs: { description: "Use Island.toString / toStringAsync / hydratable for SSR" },
    messages: {
      awaitCall:
        "Do not await {{name}}(). Use await {{name}}.toStringAsync() or await {{name}}.hydratable().",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    const { names, VariableDeclarator } = collectIslands(b);
    return {
      ImportDeclaration(node) {
        takeImport(b, node);
      },
      VariableDeclarator,
      AwaitExpression(node) {
        const arg = node.argument;
        if (arg.type !== "CallExpression") return;
        const name = islandCallee(names, arg.callee);
        if (name) context.report({ node, messageId: "awaitCall", data: { name } });
      },
    };
  },
};

const functionInState = {
  meta: {
    type: "problem",
    docs: { description: "Do not pass a function value to state() or a state setter" },
    messages: {
      init: "state({{name}}) treats the function as a lazy initializer. Wrap it: state(() => {{name}}).",
      set: "{{setter}}({{name}}) runs as an updater. Store a function with {{setter}}(() => {{name}}).",
    },
    schema: [],
  },
  create(context) {
    const b = bindings();
    const fns = new Set();
    const states = new Set();
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
        if (init && primitiveName(init, b) === "state") states.add(node.id.name);
      },
      CallExpression(node) {
        if (node.arguments.length === 0) return;
        const arg = node.arguments[0];
        if (arg.type !== "Identifier" || !fns.has(arg.name)) return;
        if (primitiveName(node, b) === "state") {
          context.report({ node: arg, messageId: "init", data: { name: arg.name } });
          return;
        }
        const setter = calleeName(node.callee);
        if (setter && states.has(setter)) {
          context.report({
            node: arg,
            messageId: "set",
            data: { setter, name: arg.name },
          });
        }
      },
    };
  },
};

module.exports = {
  meta: { name: "oxlint-plugin-ilha" },
  rules: {
    "pascal-case": pascalCase,
    "no-conditional-primitive": noConditionalPrimitive,
    "no-primitive-outside-island": noPrimitiveOutsideIsland,
    "prefer-plain-handler": preferPlainHandler,
    "prefer-lowercase-events": preferLowercaseEvents,
    "no-direct-island-call": noDirectIslandCall,
    "require-ssr-api": requireSsrApi,
    "function-in-state": functionInState,
  },
};
