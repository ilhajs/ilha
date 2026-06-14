import ilha, { batch, html, signal, untrack, type SignalAccessor } from "./index";
import { jsx, Fragment } from "./jsx-runtime";

export const typeCheckedExternalSignal: SignalAccessor<number> = signal(0);

export const TypeCheckedIsland = ilha
  .input<{ name: string }>()
  .as("span")
  .state("count", 0)
  .derived("label", ({ input, state }) => `${input.name}:${state.count()}`)
  .on("button@click", ({ event, state, derived }) => {
    const mouseEvent: MouseEvent = event;
    const label: string | undefined = derived.label();
    state.count(state.count() + 1);
    void mouseEvent;
    void label;
  })
  .effect(({ state }) => {
    const count: number = state.count();
    void count;
  })
  .render(({ input, state, derived }) => {
    const name: string = input.name;
    const count: number = state.count();
    const label: string | undefined = derived.label();
    return html`<button>${name}:${count}:${label}</button>`;
  });

export const typeCheckedJsx = jsx(Fragment, {
  children: jsx(TypeCheckedIsland, { name: "Ada" }),
});

export const typeCheckedBatchReturn: number = batch(() => {
  typeCheckedExternalSignal(1);
  return typeCheckedExternalSignal();
});

export const typeCheckedUntrackReturn: number = untrack(() => typeCheckedExternalSignal());
