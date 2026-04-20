import ilha, { html } from "ilha";

export default ilha
  .state("count", 0)
  .on("[data-action=increase]@click", ({ state }) => {
    state.count(state.count() + 1);
  })
  .on("[data-action=reset]@click", ({ state }) => {
    state.count(0);
  })
  .render(
    ({ state }) => html`
        <main>
            <div class="container">
                <h1>Ilha + Electrobun</h1>
                <p class="subtitle">A fast desktop app with hot module replacement — no framework needed</p>

                <div class="card">
                    <h2>Interactive Counter</h2>
                    <p>
                        Click the button below to test vanilla TypeScript. With HMR enabled,
                        you can edit this file and see changes instantly.
                    </p>
                    <div class="button-group">
                        <button class="primary" data-action="increase">
                            Count: ${state.count()}
                        </button>
                        <button class="secondary" data-action="reset">
                            Reset
                        </button>
                    </div>
                </div>

                <div class="card">
                    <h2>Getting Started</h2>
                    <ul>
                        <li>
                            <span class="number">1.</span>
                            Run <code>bun run dev</code> for development without HMR
                        </li>
                        <li>
                            <span class="number">2.</span>
                            Run <code>bun run dev:hmr</code> for development with hot reload
                        </li>
                        <li>
                            <span class="number">3.</span>
                            Run <code>bun run build</code> to build for production
                        </li>
                    </ul>
                </div>

                <div class="card">
                    <h2>Stack</h2>
                    <div class="stack-grid">
                        <div class="stack-item">
                            <span class="icon">⚡</span>
                            <span>Electrobun</span>
                        </div>
                        <div class="stack-item">
                            <span class="icon">🟦</span>
                            <span>TypeScript</span>
                        </div>
                        <div class="stack-item">
                            <span class="icon">🔥</span>
                            <span>Vite HMR</span>
                        </div>
                        <div class="stack-item">
                            <span class="icon">📦</span>
                            <span>Bun</span>
                        </div>
                    </div>
                </div>

                <div class="footer">
                    <p>
                        Edit <code>src/mainview/main.ts</code> and save to see HMR in action
                    </p>
                </div>
            </div>
        </main>
    `,
  );
