const DOCS = "https://ilha.build/guide/recipes/oxlint";
const PRIMITIVES = new Set(["atom", "watch", "when", "context"]);
const MEMBER_PRIMITIVES = new Map([
  ["atom", new Set(["lazy"])],
  ["watch", new Set(["once"])],
]);
const INSTRUCTIONS = new Set(["when"]);
const CALLBACK_PARENTS = new Set([
  "CallExpression",
  "NewExpression",
  "JSXExpressionContainer",
  "Property",
]);
const REACT_EVENT_ALIASES = new Map([["onDoubleClick", "ondblclick"]]);
const REACT_PROPS = new Map([
  ["className", "class"],
  ["htmlFor", "for"],
]);
const see = (rule) => `See ${DOCS}#${rule}`;
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
  const { callee } = node;
  if (callee.type === "Identifier") {
    return b.prim.get(callee.name) ?? null;
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.property.type === "Identifier"
  ) {
    const base = b.prim.get(callee.object.name);
    if (base && MEMBER_PRIMITIVES.get(base)?.has(callee.property.name)) {
      return `${base}.${callee.property.name}`;
    }
  }
  return null;
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

// A call only runs conditionally when it sits in a branch, not in the test or
// in the left operand that always evaluates.
const isGuardedBy = (ancestor, child) => {
  switch (ancestor.type) {
    case "IfStatement":
    case "ConditionalExpression": {
      return child !== ancestor.test;
    }
    case "LogicalExpression": {
      return child === ancestor.right;
    }
    case "SwitchStatement": {
      return child !== ancestor.discriminant;
    }
    case "ForStatement": {
      return child !== ancestor.init;
    }
    case "ForInStatement":
    case "ForOfStatement": {
      return child !== ancestor.right;
    }
    default: {
      return true;
    }
  }
};

const isNestedCallback = (ancestors, index) => {
  const fn = ancestors[index];
  const parent = ancestors[index - 1];
  if (!parent || fn.generator === true || !CALLBACK_PARENTS.has(parent.type)) {
    return false;
  }
  if (parent.type === "CallExpression" && parent.callee === fn) {
    return false;
  }
  return ancestors.slice(0, index).some((a) => FN_TYPES.has(a.type));
};

const noConditionalPrimitive = {
  create(context) {
    const b = bindings();
    const fnStack = [];
    const enterFn = (node) => {
      fnStack.push({ awaited: false, node });
    };
    const exitFn = () => {
      fnStack.pop();
    };
    const markAwait = () => {
      const top = fnStack.at(-1);
      if (top) {
        top.awaited = true;
      }
    };
    return {
      ArrowFunctionExpression: enterFn,
      "ArrowFunctionExpression:exit": exitFn,
      AwaitExpression: markAwait,
      CallExpression(node) {
        const name = primitiveName(node, b);
        if (!name) {
          return;
        }
        const ancestors = ancestorsOf(context, node);
        for (let i = ancestors.length - 1; i >= 0; i -= 1) {
          const a = ancestors[i];
          if (FN_TYPES.has(a.type)) {
            if (isNestedCallback(ancestors, i)) {
              context.report({ data: { name }, messageId: "nested", node });
            } else if (a.async && fnStack.at(-1)?.awaited) {
              context.report({ data: { name }, messageId: "afterAwait", node });
            }
            return;
          }
          const child = ancestors[i + 1] ?? node;
          if (CONDITIONAL.has(a.type) && isGuardedBy(a, child)) {
            context.report({ data: { name }, messageId: "conditional", node });
            return;
          }
        }
      },
      ForOfStatement(node) {
        if (node.await) {
          markAwait();
        }
      },
      FunctionDeclaration: enterFn,
      "FunctionDeclaration:exit": exitFn,
      FunctionExpression: enterFn,
      "FunctionExpression:exit": exitFn,
      ImportDeclaration(node) {
        takeImport(b, node);
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow atom/watch/when/context inside conditionals, loops, nested callbacks, or after await",
      url: `${DOCS}#no-conditional-primitive`,
    },
    messages: {
      afterAwait: `Do not call {{name}}() after an await. The component resumes at a different point on rerender, so the primitive order changes. Fix: declare every primitive before the first await. ${see("no-conditional-primitive")}`,
      conditional: `Do not call {{name}}() inside a condition or loop. Primitive registration order must be stable. Fix: call it unconditionally at the top of the component and put the branch inside the primitive or the view. ${see("no-conditional-primitive")}`,
      nested: `Do not call {{name}}() inside a nested callback. Primitives claim slots in call order on the component's own fiber. Fix: move the call to the top level of the component and use its handle in the callback. ${see("no-conditional-primitive")}`,
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
        "Call atom/watch/when/context inside a component, never at module top level",
      url: `${DOCS}#no-primitive-outside-component`,
    },
    messages: {
      outside: `Call {{name}}() inside a component. There is no fiber at module scope, so this throws at runtime. Fix: move the call into the component function. ${see("no-primitive-outside-component")}`,
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
    docs: {
      description: "Use when only inside a generator, with yield*",
      url: `${DOCS}#no-instruction-outside-generator`,
    },
    messages: {
      notGenerator: `{{name}}() returns an instruction that only a generator frame can run. Fix: make the enclosing component a generator (function*) and yield* it. ${see("no-instruction-outside-generator")}`,
      notYielded: `Call yield* with {{name}}() — calling it directly discards the instruction. Fix: write yield* {{name}}(...). ${see("no-instruction-outside-generator")}`,
    },
    schema: [],
    type: "problem",
  },
};

const isIntrinsicElement = (opening) =>
  opening.name.type === "JSXIdentifier" && /^[a-z]/u.test(opening.name.name);

const reactEventName = (name) =>
  REACT_EVENT_ALIASES.get(name) ?? `on${name.slice(2).toLowerCase()}`;

const isReactEventName = (name) => /^on[A-Z]/u.test(name);

const preferLowercaseEvents = {
  create(context) {
    return {
      JSXOpeningElement(opening) {
        if (!isIntrinsicElement(opening)) {
          return;
        }
        for (const attr of opening.attributes) {
          if (
            attr.type !== "JSXAttribute" ||
            attr.name.type !== "JSXIdentifier" ||
            !isReactEventName(attr.name.name)
          ) {
            continue;
          }
          const { name } = attr.name;
          const suggested = reactEventName(name);
          context.report({
            data: { name, suggested },
            fix: (fixer) => fixer.replaceText(attr.name, suggested),
            messageId: "camel",
            node: attr.name,
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Use lowercase DOM event props (onclick, not onClick)",
      url: `${DOCS}#prefer-lowercase-events`,
    },
    fixable: "code",
    messages: {
      camel: `Use lowercase event "{{suggested}}" instead of "{{name}}" — Ilha binds DOM event names, not React ones. Fix: rename the prop to {{suggested}}. ${see("prefer-lowercase-events")}`,
    },
    schema: [],
    type: "problem",
  },
};

const noReactProps = {
  create(context) {
    return {
      JSXOpeningElement(opening) {
        if (!isIntrinsicElement(opening)) {
          return;
        }
        for (const attr of opening.attributes) {
          if (
            attr.type !== "JSXAttribute" ||
            attr.name.type !== "JSXIdentifier"
          ) {
            continue;
          }
          const { name } = attr.name;
          const suggested = isReactEventName(name)
            ? reactEventName(name)
            : REACT_PROPS.get(name);
          if (!suggested) {
            continue;
          }
          context.report({
            data: { name, suggested },
            fix: (fixer) => fixer.replaceText(attr.name, suggested),
            messageId: "react",
            node: attr.name,
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Use DOM attribute names on intrinsic JSX elements (class, for, onclick), not React ones",
      url: `${DOCS}#no-react-props`,
    },
    fixable: "code",
    messages: {
      react: `Ilha renders DOM attribute names, so "{{name}}" does nothing useful on a native element. Fix: use "{{suggested}}". ${see("no-react-props")}`,
    },
    schema: [],
    type: "problem",
  },
};

const jsxName = (opening) => {
  const { name } = opening;
  if (name.type === "JSXIdentifier") {
    return name.name;
  }
  if (name.type === "JSXMemberExpression") {
    return "member";
  }
  return null;
};

const isComponentElement = (node) => {
  if (node?.type !== "JSXElement") {
    return false;
  }
  const name = jsxName(node.openingElement);
  return name !== null && !/^[a-z]/u.test(name);
};

const hasKey = (node) =>
  node.openingElement.attributes.some(
    (attr) =>
      attr.type === "JSXSpreadAttribute" ||
      (attr.type === "JSXAttribute" &&
        attr.name.type === "JSXIdentifier" &&
        attr.name.name === "key")
  );

const returnedElements = (fn) => {
  const { body } = fn;
  if (body.type !== "BlockStatement") {
    return [body];
  }
  return body.body
    .filter((stmt) => stmt.type === "ReturnStatement")
    .map((stmt) => stmt.argument);
};

const requireKeyInMap = {
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "map"
        ) {
          return;
        }
        const [cb] = node.arguments;
        if (
          !cb ||
          (cb.type !== "ArrowFunctionExpression" &&
            cb.type !== "FunctionExpression")
        ) {
          return;
        }
        for (const el of returnedElements(cb)) {
          if (isComponentElement(el) && !hasKey(el)) {
            context.report({
              data: { name: jsxName(el.openingElement) },
              messageId: "key",
              node: el.openingElement,
            });
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Components returned from .map() need a key prop",
      url: `${DOCS}#require-key-in-map`,
    },
    messages: {
      key: `<{{name}}> returned from .map() has no key. Without a stable key, Ilha reuses component instances by position and their atoms attach to the wrong item. Fix: add key={item.id}. ${see("require-key-in-map")}`,
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
        const [arg] = node.arguments;
        if (!arg || primitiveName(node, b) !== "atom") {
          return;
        }
        if (FN_TYPES.has(arg.type)) {
          context.report({ messageId: "derived", node: arg });
          return;
        }
        if (
          arg.type === "Identifier" &&
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
        const { init } = node;
        if (node.id.type === "Identifier" && init && FN_TYPES.has(init.type)) {
          fns.add(node.id.name);
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "atom(fn) and atom(() => …) are invalid — use atom.lazy, Atom.map, or Atom.transform",
      url: `${DOCS}#function-in-atom`,
    },
    messages: {
      derived: `atom(() => …) is not supported. Fix: use atom.lazy(() => …) for one-time init, or atom(Atom.map(...)) / atom(Atom.transform(...)) for derived values. ${see("function-in-atom")}`,
      init: `atom({{name}}) is not valid. Fix: use atom.lazy(() => {{name}}) to store a function value. ${see("function-in-atom")}`,
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
    "no-react-props": noReactProps,
    "prefer-lowercase-events": preferLowercaseEvents,
    "require-key-in-map": requireKeyInMap,
  },
};
