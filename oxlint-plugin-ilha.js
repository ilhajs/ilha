// eslint-plugin-ilha.js
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;

const ilhaPascalCase = {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "Enforce PascalCase for ilha island variable names",
    },
    messages: {
      notPascalCase: 'Island variable "{{name}}" must be PascalCase (e.g. "{{suggested}}").',
    },
    schema: [],
  },

  create(context) {
    function isIlhaRenderCall(node) {
      if (
        node.type !== "CallExpression" ||
        node.callee.type !== "MemberExpression" ||
        node.callee.property.name !== "render"
      ) {
        return false;
      }

      // Walk leftward through call chains AND member expressions
      let obj = node.callee.object;
      while (obj) {
        if (obj.type === "CallExpression") {
          obj = obj.callee?.object; // 👈 optional chain — callee may lack .object
        } else if (obj.type === "MemberExpression") {
          obj = obj.object; // 👈 handle bare .foo accesses in the chain
        } else {
          break;
        }
      }

      return obj?.type === "Identifier" && obj.name === "ilha";
    }

    function toPascalCase(name) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init && isIlhaRenderCall(node.init)) {
          const name = node.id.name;
          if (!PASCAL_CASE.test(name)) {
            const suggested = toPascalCase(name);
            context.report({
              node: node.id,
              messageId: "notPascalCase",
              data: { name, suggested },
              fix(fixer) {
                // 👈 rename the declarator
                return fixer.replaceText(node.id, suggested);
              },
            });
          }
        }
      },
    };
  },
};

module.exports = {
  meta: { name: "oxlint-plugin-ilha" },
  rules: { "pascal-case": ilhaPascalCase },
};
