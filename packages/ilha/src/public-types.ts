import ilha, {
  batch,
  html,
  signal,
  untrack,
  type NativeEventHandler,
  type SignalAccessor,
} from "./index";
import { jsx, Fragment } from "./jsx-runtime";

export const typeCheckedNativeHandler: NativeEventHandler<InputEvent> = (event, { signal }) => {
  const inputEvent: InputEvent = event;
  const abortSignal: AbortSignal = signal;
  void inputEvent;
  void abortSignal;
};

export const typeCheckedExternalSignal: SignalAccessor<number> = signal(0);
typeCheckedExternalSignal((previous) => previous + 1);
// @ts-expect-error updater must return the signal value type
typeCheckedExternalSignal(() => "wrong");

const nextCallback = () => "next";
const typeCheckedFunctionSignal = signal<() => string>(() => "initial");
// @ts-expect-error function values must be returned from an updater wrapper
typeCheckedFunctionSignal(nextCallback);
typeCheckedFunctionSignal(() => nextCallback);

const typeCheckedNullableFunctionSignal = signal<(() => string) | null>(null);
// @ts-expect-error function members of unions must also use an updater wrapper
typeCheckedNullableFunctionSignal(nextCallback);
typeCheckedNullableFunctionSignal(() => nextCallback);
typeCheckedNullableFunctionSignal(null);

export const TypeCheckedDirectIsland = ilha(() => html`<p>Direct island</p>`);
export const typeCheckedDirectHtml: string = TypeCheckedDirectIsland.toString();
export const typeCheckedDirectUnmount: () => void = TypeCheckedDirectIsland.mount(
  document.createElement("div"),
);
void TypeCheckedDirectIsland.hydratable({}, { name: "TypeCheckedDirectIsland" });
export const TypeCheckedDirectInputIsland = ilha<{ label: string }>(({ input }) => {
  const label: string = input.label;
  // @ts-expect-error undeclared input keys are not available
  void input.missing;
  return html`<p>${label}</p>`;
});
TypeCheckedDirectInputIsland({ label: "Inbox" });
// @ts-expect-error direct island input props retain their declared types
TypeCheckedDirectInputIsland({ label: 42 });
// @ts-expect-error direct island render functions must return HTML
ilha(() => 42);

export const TypeCheckedIsland = ilha
  .input<{ name: string }>()
  .as("span")
  .state("count", 0)
  .derived("label", ({ input, state }) => `${input.name}:${state.count()}`)
  .action("increment", (amount: number, { state }) => {
    state.count((previous) => previous + amount);
    return state.count();
  })
  .action("save", async (name: string) => name.length)
  .on("button@click", ({ event, state, derived, action }) => {
    const mouseEvent: MouseEvent = event;
    const label: string | undefined = derived.label();
    state.count((previous) => previous + 1);
    action.increment(2);
    // @ts-expect-error increment requires a number payload
    action.increment("wrong");
    void mouseEvent;
    void label;
  })
  .effect(({ state, action }) => {
    const count: number = state.count();
    const pending: boolean = action.save.pending;
    void count;
    void pending;
  })
  .onMount(({ signal }) => {
    const abortSignal: AbortSignal = signal;
    void abortSignal.aborted;
  })
  .render(({ input, state, derived, action }) => {
    const name: string = input.name;
    const count: number = state.count();
    const label: string | undefined = derived.label();
    const savedLength: number | undefined = action.save.data;
    const actionError: Error | undefined = action.save.error;
    void savedLength;
    void actionError;
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
