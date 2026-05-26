import { Sandpack } from "@codesandbox/sandpack-react";
import dedent from "dedent";

export function Sandbox({ script }: { script: string }) {
  return (
    <Sandpack
      theme="auto"
      template="vanilla-ts"
      options={{
        editorHeight: 560,
        activeFile: "/example.tsx",
        visibleFiles: ["/example.tsx"],
      }}
      customSetup={{
        dependencies: {
          ilha: "latest",
        },
      }}
      files={{
        "/example.tsx": { code: script },
        "/index.ts": {
          code: dedent`
            import "./styles.css";
            import { mount } from "ilha";
            import Example from "./example"

            mount({ Example });
          `,
        },
        "/index.html": { code: '<div data-ilha="Example"></div>' },
        "/styles.css": {
          code: dedent`
            @import 'https://cdn.jsdelivr.net/npm/@faith-tools/sensible-ui@latest/dist/sensible-ui.min.css';

            body {
              padding: 1rem;
            }
          `,
        },
        "tsconfig.json": dedent`
          {
            "compilerOptions": {
              "strict": true,
              "module": "commonjs",
              "jsx": "react-jsx",
              "jsxImportSource": "ilha",
              "esModuleInterop": true,
              "sourceMap": true,
              "allowJs": true,
              "lib": [
                "es6",
                "dom"
              ],
              "rootDir": "src",
              "moduleResolution": "node"
            }
          }
        `,
      }}
    />
  );
}
