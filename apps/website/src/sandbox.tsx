import { Sandpack } from "@codesandbox/sandpack-react";
import dedent from "dedent";

export function Sandbox({ script, template }: { script: string; template: string }) {
  return (
    <Sandpack
      theme="auto"
      template="vanilla-ts"
      options={{
        editorHeight: 560,
      }}
      customSetup={{
        dependencies: {
          ilha: "latest",
        },
      }}
      files={{
        "/index.ts": { code: script },
        "/index.html": { code: template },
        "/styles.css": {
          code: dedent`
            @import 'https://cdn.jsdelivr.net/npm/@faith-tools/sensible-ui@latest/dist/sensible-ui.min.css';

            body {
              padding: 1rem;
            }
          `,
        },
      }}
    />
  );
}
