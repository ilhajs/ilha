export const example = `import { ilha } from "ilha";
import { Button } from "areia";

const Panel = ilha
.transition({
enter: async (host) => {
await host.animate(
[
{
opacity: 0,
transform: "translateY(12px) scale(0.98)",
},
{
opacity: 1,
transform: "translateY(0) scale(1)",
},
],
{ duration: 300, easing: "ease-out", fill: "forwards" },
).finished;
},
leave: async (host) => {
await host.animate(
[
{
opacity: 1,
transform: "translateY(0) scale(1)",
},
{
opacity: 0,
transform: "translateY(-8px) scale(0.98)",
},
],
{
duration: 240,
easing: "ease-in",
fill: "forwards",
},
).finished;
},
})
.render(() => (

<div class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-900">
  <p class="font-medium">Animated panel</p>
  <p class="mt-1 text-sm text-green-800">
    Fades and slides in on mount; animates out before unmount.
  </p>
</div>
));

export default ilha
  .state("open", true)
  .action("toggle", (_, { state }) => state.open((open) => !open))
  .render(({ state, action }) => (
    <div class="flex min-h-52 flex-col gap-4">
      <Button variant="outline" onclick={action.toggle}>
        {state.open() ? "Dismiss panel" : "Show panel"}
      </Button>
      {state.open() ? <Panel /> : null}
      <p class="text-sm text-areia-muted">
        Toggle to replay enter and leave; leave is awaited before cleanup runs.
      </p>
    </div>
  ));
`;
