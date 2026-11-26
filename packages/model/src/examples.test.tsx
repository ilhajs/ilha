/**
 * Example ports: Effect UI's `counter`, `counters`, `file-preview`,
 * `interrupting-commands` and `snake` examples, plus the launch-article
 * examples (Counter, Page/Counter, CartProvider/Shop, Posts with
 * `SearchPosts`, Disclosure/Details) and the Story/Scene/Play counter
 * coverage, as acceptance tests over the final `@ilha/model` APIs.
 *
 * Story covers pure update/Command/subscription intent, Scene covers view
 * interaction over VNodes, and Play covers real DOM/mount effects.
 */

import { describe, expect, it } from "bun:test";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { Headless, QueryArgsContext } from "./component.ts";
import * as DomSubscription from "./dom-subscription.ts";
import { Command, Component, defineComponent, TaggedEnum } from "./index.ts";
import type { ModelComponent } from "./index.ts";
import * as Query from "./query.ts";
import * as Subscription from "./subscription.ts";
import * as Locator from "./test/locator.ts";
import * as Play from "./test/play.ts";
import * as Scene from "./test/scene.ts";
import type { AnyComponent, PropsOf } from "./test/steps.ts";
import * as Story from "./test/story.ts";
import { layer as testHostLayer } from "./test/test-host.ts";

const runStory = <C extends AnyComponent, A>(
  component: C,
  props: PropsOf<C>,
  fn: (story: Story.Steps<C>) => A
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.map(Story.make(component, props), fn))
  );

const runScene = <C extends AnyComponent, A>(
  component: C,
  props: PropsOf<C>,
  fn: (scene: Scene.Steps<C>) => A
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.map(Scene.make(component, props), fn))
  );

const runPlay = <C extends AnyComponent, A>(
  component: C,
  props: PropsOf<C>,
  fn: (play: Play.Play<C>) => Effect.Effect<A, Play.StepError>
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.flatMap(Play.make(component, props), fn),
        testHostLayer()
      )
    )
  );

// -----------------------------------------------------------------------------
// Launch Counter + Page/Counter
// -----------------------------------------------------------------------------

const CounterMessage = TaggedEnum({
  ClickedDecrement: {},
  ClickedIncrement: {},
});

const ExCounterDef = defineComponent({
  message: CounterMessage,
  model: Schema.Struct({ count: Schema.Number }),
  name: "ExCounter",
  props: Schema.Struct({ label: Schema.String }),
});

const ExCounter = ExCounterDef.make({
  init: () => ({ count: 0 }),
  update: {
    // A handler may return the next Model as a bare value.
    ClickedDecrement: ($) => ({ count: $.model.count - 1 }),
    ClickedIncrement: ($) => ({ count: $.model.count + 1 }),
  },
  view: (h, model) => (
    <div>
      <span>{h.props.label}</span>
      <button
        aria-label="Decrement"
        onclick={h.send(CounterMessage.ClickedDecrement())}
      >
        -
      </button>
      <output>{String(model.count)}</output>
      <button
        aria-label="Increment"
        onclick={h.send(CounterMessage.ClickedIncrement())}
      >
        +
      </button>
    </div>
  ),
});

const PageMessage = TaggedEnum({ ClickedToggleCounter: {} });

const ExPage = defineComponent({
  message: PageMessage,
  model: Schema.Struct({ isCounterShown: Schema.Boolean }),
  name: "ExPage",
}).make({
  init: () => ({ isCounterShown: true }),
  update: {
    ClickedToggleCounter: ($) => ({ isCounterShown: !$.model.isCounterShown }),
  },
  view: (h, model) => (
    <div>
      <button onclick={h.send(PageMessage.ClickedToggleCounter())}>
        {model.isCounterShown ? "Hide counter" : "Show counter"}
      </button>
      {model.isCounterShown ? <ExCounter props={{ label: "Likes" }} /> : null}
    </div>
  ),
});

describe("launch Counter and Page/Counter", () => {
  it("counts from its label, and props never reach update", async () => {
    await runStory(ExCounter, { label: "Likes" }, (s) => {
      expect(s.model.count).toBe(0);
      s.send(CounterMessage.ClickedIncrement()).send(
        CounterMessage.ClickedIncrement()
      );
      expect(s.model.count).toBe(2);
      s.send(CounterMessage.ClickedDecrement());
      expect(s.model.count).toBe(1);
      s.props({ label: "Dislikes" });
      expect(s.model.count).toBe(1);
      expect(s.current.props).toEqual({ label: "Dislikes" });
      s.expectNone();
    });
  });

  it("toggles its Counter child in the view", async () => {
    await runScene(ExPage, {}, (scene) => {
      expect(Scene.children(scene.root, ExCounter)).toHaveLength(1);
      scene
        .click(Locator.text("Hide counter"))
        .expect(Locator.text("Show counter"))
        .toExist();
      expect(Scene.children(scene.root, ExCounter)).toHaveLength(0);
      scene
        .click(Locator.text("Show counter"))
        .expect(Locator.text("Hide counter"))
        .toExist();
      expect(Scene.children(scene.root, ExCounter)).toHaveLength(1);
    });
  });
});

// -----------------------------------------------------------------------------
// Launch autocounter: delayed reset, auto-count subscription, isRunning
// -----------------------------------------------------------------------------

const AutoMessage = TaggedEnum({
  ClickedAdd: { amount: Schema.Number },
  ClickedResetAfterDelay: {},
  ClickedToggleAutoCount: {},
  CompletedDelayReset: {},
  Ticked: {},
});

const DelayReset = Command.make("ExDelayReset", { args: {} }, () =>
  Effect.succeed(AutoMessage.CompletedDelayReset())
);

const ExAutoCounter = defineComponent({
  message: AutoMessage,
  model: Schema.Struct({
    count: Schema.Number,
    isAutoCounting: Schema.Boolean,
  }),
  name: "ExAutoCounter",
}).make({
  init: () => ({ count: 0, isAutoCounting: false }),
  subscriptions: ({ model }) => [
    model.isAutoCounting &&
      Subscription.make(
        "tick",
        Stream.tick("1 second").pipe(
          Stream.drop(1),
          Stream.map(() => AutoMessage.Ticked())
        )
      ),
  ],
  update: {
    ClickedAdd: ($, { amount }) =>
      $.evolve({ count: (count) => count + amount }),
    ClickedResetAfterDelay: ($) => $.run(DelayReset.make({})),
    ClickedToggleAutoCount: ($) => $.evolve({ isAutoCounting: (on) => !on }),
    CompletedDelayReset: ($) => $.evolve({ count: 0 }),
    Ticked: ($) => $.evolve({ count: (count) => count + 1 }),
  },
  view: (h, model) => (
    <div>
      <output>{String(model.count)}</output>
      <button onclick={h.send(AutoMessage.ClickedAdd({ amount: -1 }))}>
        -1
      </button>
      <button onclick={h.send(AutoMessage.ClickedAdd({ amount: 1 }))}>
        +1
      </button>
      <button
        disabled={h.isRunning(DelayReset)}
        onclick={h.send(AutoMessage.ClickedResetAfterDelay())}
      >
        {h.isRunning(DelayReset) ? "Resetting" : "Reset in 1 second"}
      </button>
      <button onclick={h.send(AutoMessage.ClickedToggleAutoCount())}>
        {model.isAutoCounting ? "Stop" : "Auto-count"}
      </button>
    </div>
  ),
});

describe("autocounter Story", () => {
  it("resets after the delay", async () => {
    await runStory(ExAutoCounter, {}, (s) => {
      s.given({ count: 5, isAutoCounting: false })
        .send(AutoMessage.ClickedResetAfterDelay())
        .expectExact(DelayReset)
        .resolve(DelayReset, AutoMessage.CompletedDelayReset());
      expect(s.model.count).toBe(0);
      s.expectNone();
    });
  });

  it("counts each tick while auto-counting", async () => {
    await runStory(ExAutoCounter, {}, (s) => {
      expect(s.subscriptions).toEqual([]);
      s.send(AutoMessage.ClickedToggleAutoCount());
      expect(s.subscriptions).toEqual(["tick"]);
      s.subscription("tick", AutoMessage.Ticked());
      expect(s.model.count).toBe(1);
      s.send(AutoMessage.ClickedToggleAutoCount());
      expect(s.subscriptions).toEqual([]);
      s.expectNone();
    });
  });
});

describe("autocounter Scene", () => {
  it("counts by clicking", async () => {
    await runScene(ExAutoCounter, {}, (scene) => {
      scene.click("+1").click("+1").click("-1");
      scene.expect(Locator.tag("output")).toHaveText("1");
    });
  });

  it("disables the reset button while a reset is running", async () => {
    await runScene(ExAutoCounter, {}, (scene) => {
      scene
        .given({ count: 5, isAutoCounting: false })
        .click("Reset in 1 second")
        .expect(Locator.text("Resetting"))
        .toExist();
      scene
        .expect(Locator.text("Resetting"))
        .toBeDisabled()
        .resolve(DelayReset, AutoMessage.CompletedDelayReset())
        .expect(Locator.tag("output"))
        .toHaveText("0");
    });
  });
});

describe("autocounter Play", () => {
  it("runs the real runtime: click to add, reset after the delay", async () => {
    await runPlay(ExAutoCounter, {}, (play) =>
      Effect.gen(function* scenario() {
        yield* play.click(Locator.text("+1"));
        yield* play.expect(Locator.tag("output")).toHaveText("1");
        yield* play.click(Locator.text("Reset in 1 second"));
        yield* play.expect(Locator.tag("output")).toHaveText("0");
      })
    );
  });
});

// -----------------------------------------------------------------------------
// Counters: keyed children keep their own count
// -----------------------------------------------------------------------------

const RowMessage = TaggedEnum({
  ClickedDecrement: {},
  ClickedIncrement: {},
});

const ExCounterRow = defineComponent({
  message: RowMessage,
  model: Schema.Struct({ count: Schema.Number }),
  name: "ExCounterRow",
  props: Schema.Struct({ id: Schema.Number }),
}).make({
  init: () => ({ count: 0 }),
  update: {
    ClickedDecrement: ($) => ({ count: $.model.count - 1 }),
    ClickedIncrement: ($) => ({ count: $.model.count + 1 }),
  },
  view: (h, model) => (
    <div>
      <button
        data-testid={`dec-${h.props.id}`}
        aria-label="Decrement"
        onclick={h.send(RowMessage.ClickedDecrement())}
      >
        -
      </button>
      <output data-testid={`count-${h.props.id}`}>{String(model.count)}</output>
      <button
        data-testid={`inc-${h.props.id}`}
        aria-label="Increment"
        onclick={h.send(RowMessage.ClickedIncrement())}
      >
        +
      </button>
    </div>
  ),
});

const CountersMessage = TaggedEnum({
  ClickedAddCounter: {},
  ClickedRemoveCounter: { id: Schema.Number },
});

const ExCounters = defineComponent({
  message: CountersMessage,
  model: Schema.Struct({
    counterIds: Schema.Array(Schema.Number),
    nextCounterId: Schema.Number,
  }),
  name: "ExCounters",
}).make({
  init: () => ({ counterIds: [1, 2, 3], nextCounterId: 4 }),
  update: {
    ClickedAddCounter: ($) =>
      $.evolve({
        counterIds: [...$.model.counterIds, $.model.nextCounterId],
        nextCounterId: $.model.nextCounterId + 1,
      }),
    ClickedRemoveCounter: ($, { id }) =>
      $.evolve({
        counterIds: $.model.counterIds.filter((counterId) => counterId !== id),
      }),
  },
  view: (h, model) => (
    <div>
      {model.counterIds.map((id) => (
        <div data-testid={`row-${id}`}>
          <span>{`Counter ${id}`}</span>
          <ExCounterRow key={String(id)} props={{ id }} />
          <button
            data-testid={`remove-${id}`}
            onclick={h.send(CountersMessage.ClickedRemoveCounter({ id }))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        data-testid="add"
        onclick={h.send(CountersMessage.ClickedAddCounter())}
      >
        + Add Counter
      </button>
    </div>
  ),
});

describe("counters", () => {
  it("adds and removes ids in the parent", async () => {
    await runStory(ExCounters, {}, (s) => {
      s.send(CountersMessage.ClickedRemoveCounter({ id: 2 }));
      expect(s.model.counterIds).toEqual([1, 3]);
      s.send(CountersMessage.ClickedAddCounter());
      expect(s.model.counterIds).toEqual([1, 3, 4]);
      expect(s.model.nextCounterId).toBe(5);
      s.expectNone();
    });
  });

  it("adding, updating, and removing counters preserves each counter's count", async () => {
    await runPlay(ExCounters, {}, (play) =>
      Effect.gen(function* scenario() {
        yield* play.click('[data-testid="inc-1"]');
        yield* play.click('[data-testid="dec-3"]');
        yield* play.expect(Locator.testId("count-1")).toHaveText("1");
        yield* play.expect(Locator.testId("count-2")).toHaveText("0");
        yield* play.expect(Locator.testId("count-3")).toHaveText("-1");
        yield* play.click('[data-testid="remove-2"]');
        yield* play.expect(Locator.testId("row-2")).toBeAbsent();
        yield* play.expect(Locator.testId("count-1")).toHaveText("1");
        yield* play.expect(Locator.testId("count-3")).toHaveText("-1");
        yield* play.click('[data-testid="add"]');
        yield* play.expect(Locator.testId("count-4")).toHaveText("0");
      })
    );
  });
});

// -----------------------------------------------------------------------------
// File preview: choose, read, cancel
// -----------------------------------------------------------------------------

const Preview = TaggedEnum({
  Cancelled: { name: Schema.String },
  Failed: { name: Schema.String },
  NoFile: {},
  Read: { head: Schema.String, lines: Schema.Number, name: Schema.String },
  Reading: { name: Schema.String },
});

const PreviewMessage = TaggedEnum({
  ChoseFiles: {
    files: Schema.Array(
      Schema.Struct({ name: Schema.String, text: Schema.String })
    ),
  },
  ClickedCancel: {},
  CompletedReadFile: {
    head: Schema.String,
    lines: Schema.Number,
    name: Schema.String,
  },
  FailedReadFile: { name: Schema.String },
});

const ReadFile = Command.make(
  "ExReadFile",
  { args: { name: Schema.String, text: Schema.String } },
  ({ name, text }) =>
    Effect.match(
      Effect.promise(() => new Blob([text]).text()),
      {
        onFailure: () => PreviewMessage.FailedReadFile({ name }),
        onSuccess: (full) => {
          const lines = full.split("\n");
          return PreviewMessage.CompletedReadFile({
            head: lines.slice(0, 10).join("\n"),
            lines: lines.length,
            name,
          });
        },
      }
    )
);

const ExFilePreview = defineComponent({
  message: PreviewMessage,
  model: Preview,
  name: "ExFilePreview",
}).make({
  init: () => Preview.NoFile(),
  update: {
    ChoseFiles: ($, { files: [file] }) =>
      file === undefined
        ? $.model
        : $.set(Preview.Reading({ name: file.name })).run(
            ReadFile.make({ name: file.name, text: file.text })
          ),
    ClickedCancel: ($) =>
      $.model._tag === "Reading"
        ? $.set(Preview.Cancelled({ name: $.model.name })).run(
            Command.interrupt(ReadFile)
          )
        : $.model,
    CompletedReadFile: (_, { head, lines, name }) =>
      Preview.Read({ head, lines, name }),
    FailedReadFile: (_, { name }) => Preview.Failed({ name }),
  },
  view: (h, preview) => (
    <div>
      <h1>File Preview</h1>
      <label>
        Choose a file
        <input
          data-testid="chooser"
          type="file"
          onchange={h.send((event) => {
            // Synthetic payloads carry the picked text under `value`.
            // SAFETY: synthetic payloads carry the picked text under `value`, per the comment above
            const payload = event as { readonly value?: string };
            return PreviewMessage.ChoseFiles({
              files: [{ name: "chosen.txt", text: payload.value ?? "" }],
            });
          })}
        />
      </label>
      {Preview.match(preview, {
        Cancelled: ({ name }) => <p>{`Cancelled reading ${name}.`}</p>,
        Failed: ({ name }) => <p>{`Couldn't read ${name}.`}</p>,
        NoFile: () => <p>Choose a text file to preview it.</p>,
        Read: ({ head, lines, name }) => (
          <section>
            <h2>{`${name}: ${lines} lines`}</h2>
            <pre>{head}</pre>
          </section>
        ),
        Reading: ({ name }) => (
          <div>
            <span>{`Reading ${name}…`}</span>
            <button onclick={h.send(PreviewMessage.ClickedCancel())}>
              Cancel
            </button>
          </div>
        ),
      })}
    </div>
  ),
});

describe("file preview", () => {
  const notes = { name: "notes.txt", text: "one\ntwo\nthree" };

  it("choosing a file reads it and shows its line count and first lines", async () => {
    await runStory(ExFilePreview, {}, (s) => {
      s.send(PreviewMessage.ChoseFiles({ files: [notes] }))
        .expectExact(
          ReadFile.make({ name: "notes.txt", text: "one\ntwo\nthree" })
        )
        .resolve(
          ReadFile,
          PreviewMessage.CompletedReadFile({
            head: "one\ntwo\nthree",
            lines: 3,
            name: "notes.txt",
          })
        );
      expect(s.model).toEqual(
        Preview.Read({ head: "one\ntwo\nthree", lines: 3, name: "notes.txt" })
      );
      s.expectNone();
    });
  });

  it("cancelling a read interrupts it and marks it cancelled", async () => {
    await runStory(ExFilePreview, {}, (s) => {
      s.send(PreviewMessage.ChoseFiles({ files: [notes] }))
        // The interrupt is issued by an update, so the pending run is kept first.
        .keepPending(ReadFile)
        .send(PreviewMessage.ClickedCancel());
      expect(s.interrupted.map((command) => command.args)).toEqual([
        { name: "notes.txt", text: "one\ntwo\nthree" },
      ]);
      expect(s.model).toEqual(Preview.Cancelled({ name: "notes.txt" }));
      s.expectNone();
    });
  });

  it("choosing no file changes nothing, and a failed read names the file", async () => {
    await runStory(ExFilePreview, {}, (s) => {
      s.send(PreviewMessage.ChoseFiles({ files: [] }));
      expect(s.model).toEqual(Preview.NoFile());
      s.send(PreviewMessage.ChoseFiles({ files: [notes] })).resolve(
        ReadFile,
        PreviewMessage.FailedReadFile({ name: "notes.txt" })
      );
      expect(s.model).toEqual(Preview.Failed({ name: "notes.txt" }));
      s.expectNone();
    });
  });
});

// -----------------------------------------------------------------------------
// Interrupting commands: uploads
// -----------------------------------------------------------------------------

const UploadStatus = Schema.Literals(["Uploading", "Done", "Cancelled"]);
type UploadStatusT = typeof UploadStatus.Type;

const UploadSchema = Schema.Struct({
  fileName: Schema.String,
  id: Schema.Number,
  sizeMegabytes: Schema.Number,
  status: UploadStatus,
});
type Upload = typeof UploadSchema.Type;

const UploadsMessage = TaggedEnum({
  ClickedCancelAllUploads: {},
  ClickedCancelUpload: { uploadId: Schema.Number },
  ClickedRestartUpload: { uploadId: Schema.Number },
  ClickedStartUpload: {},
  CompletedUploadFile: { uploadId: Schema.Number },
});

interface FakeFile {
  readonly name: string;
  readonly sizeMegabytes: number;
}

const FAKE_FILES: readonly FakeFile[] = [
  { name: "vacation-photos.zip", sizeMegabytes: 48 },
  { name: "demo-recording.mp4", sizeMegabytes: 87 },
  { name: "quarterly-report.pdf", sizeMegabytes: 12 },
];

// oxlint-disable-next-line typescript/no-explicit-any -- factory Self is test-only tag identity; any keeps Layer plumbing permissive
const UploadFile = Command.Service<any>()("ExUploadFile", {
  args: { sizeMegabytes: Schema.Number, uploadId: Schema.Number },
  group: ["uploadId"],
  mode: "switch",
  success: UploadsMessage,
});

const withStatus =
  (uploadId: number, status: UploadStatusT) =>
  (uploads: readonly Upload[]): readonly Upload[] =>
    uploads.map((upload) =>
      upload.id === uploadId ? { ...upload, status } : upload
    );

const ExUploads = defineComponent({
  message: UploadsMessage,
  model: Schema.Struct({
    uploadId: Schema.Number,
    uploads: Schema.Array(UploadSchema),
  }),
  name: "ExUploads",
}).make({
  init: () => ({ uploadId: 0, uploads: [] }),
  update: {
    ClickedCancelAllUploads: ($) =>
      $.evolve({
        uploads: (uploads) =>
          uploads.map((upload) =>
            // SAFETY: "Cancelled" is an exact member of the UploadStatus literals
            upload.status === "Uploading"
              ? { ...upload, status: "Cancelled" as UploadStatusT }
              : upload
          ),
      }).run(Command.interrupt(UploadFile)),
    ClickedCancelUpload: ($, { uploadId }) =>
      $.model.uploads.some(
        (upload) => upload.id === uploadId && upload.status === "Uploading"
      )
        ? $.evolve({ uploads: withStatus(uploadId, "Cancelled") }).run(
            Command.interrupt(UploadFile, { uploadId })
          )
        : $.model,
    ClickedRestartUpload: ($, { uploadId }) => {
      const upload = $.model.uploads.find(
        (candidate) =>
          candidate.id === uploadId && candidate.status === "Cancelled"
      );
      return upload === undefined
        ? $.model
        : $.evolve({ uploads: withStatus(uploadId, "Uploading") }).run(
            // SAFETY: UploadFile.make is already issued; never only marks the run slot the kernel fills
            UploadFile.make({
              sizeMegabytes: upload.sizeMegabytes,
              uploadId,
            }) as never
          );
    },
    ClickedStartUpload: ($) => {
      const file =
        FAKE_FILES[$.model.uploadId % FAKE_FILES.length] ?? FAKE_FILES[0];
      const upload: Upload = {
        fileName: file.name,
        id: $.model.uploadId,
        sizeMegabytes: file.sizeMegabytes,
        status: "Uploading",
      };
      return $.set({
        uploadId: $.model.uploadId + 1,
        uploads: [...$.model.uploads, upload],
      }).run(
        // SAFETY: UploadFile.make is already issued; never only marks the run slot the kernel fills
        UploadFile.make({
          sizeMegabytes: upload.sizeMegabytes,
          uploadId: upload.id,
        }) as never
      );
    },
    CompletedUploadFile: ($, { uploadId }) =>
      $.evolve({ uploads: withStatus(uploadId, "Done") }),
  },
  view: (h, model) => (
    <div>
      <h1>File Uploads</h1>
      <button onclick={h.send(UploadsMessage.ClickedStartUpload())}>
        Upload a file
      </button>
      {model.uploads.some((upload) => upload.status === "Uploading") ? (
        <button onclick={h.send(UploadsMessage.ClickedCancelAllUploads())}>
          Cancel all
        </button>
      ) : null}
      {model.uploads.length === 0 ? (
        <p>Nothing here yet. Start an upload.</p>
      ) : (
        <ul>
          {model.uploads.map((upload) => (
            <li key={String(upload.id)}>
              <span>{upload.fileName}</span>
              <span>{`${upload.sizeMegabytes} MB`}</span>
              <span>{upload.status}</span>
              {upload.status === "Uploading" ? (
                <button
                  aria-label={`Cancel upload ${upload.id}`}
                  onclick={h.send(
                    UploadsMessage.ClickedCancelUpload({ uploadId: upload.id })
                  )}
                >
                  Cancel
                </button>
              ) : null}
              {upload.status === "Cancelled" ? (
                <button
                  aria-label={`Restart upload ${upload.id}`}
                  onclick={h.send(
                    UploadsMessage.ClickedRestartUpload({ uploadId: upload.id })
                  )}
                >
                  Restart
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  ),
});

const firstUpload = UploadFile.make({ sizeMegabytes: 48, uploadId: 0 });
const secondUpload = UploadFile.make({ sizeMegabytes: 87, uploadId: 1 });

describe("uploads Story", () => {
  it("starting an upload appends an Uploading entry and runs UploadFile", async () => {
    await runStory(ExUploads, {}, (s) => {
      s.send(UploadsMessage.ClickedStartUpload());
      expect(s.model.uploads).toEqual([
        {
          fileName: "vacation-photos.zip",
          id: 0,
          sizeMegabytes: 48,
          status: "Uploading",
        },
      ]);
      expect(s.model.uploadId).toBe(1);
      s.expectExact(firstUpload).resolve(
        UploadFile,
        UploadsMessage.CompletedUploadFile({ uploadId: 0 })
      );
      expect(s.model.uploads.map((upload) => upload.status)).toEqual(["Done"]);
      s.expectNone();
    });
  });

  it("cancelling an upload interrupts it and marks it Cancelled", async () => {
    await runStory(ExUploads, {}, (s) => {
      s.send(UploadsMessage.ClickedStartUpload()).send(
        UploadsMessage.ClickedCancelUpload({ uploadId: 0 })
      );
      expect(s.interrupted.map((command) => command.args)).toEqual([
        firstUpload.args,
      ]);
      expect(s.model.uploads.map((upload) => upload.status)).toEqual([
        "Cancelled",
      ]);
      s.expectNone();
    });
  });

  it("cancelling a finished upload changes nothing and interrupts nothing", async () => {
    await runStory(ExUploads, {}, (s) => {
      s.send(UploadsMessage.ClickedStartUpload())
        .resolve(
          UploadFile,
          UploadsMessage.CompletedUploadFile({ uploadId: 0 })
        )
        .send(UploadsMessage.ClickedCancelUpload({ uploadId: 0 }));
      expect(s.interrupted).toEqual([]);
      expect(s.model.uploads.map((upload) => upload.status)).toEqual(["Done"]);
      s.expectNone();
    });
  });

  it("cancelling one upload leaves the other running", async () => {
    await runStory(ExUploads, {}, (s) => {
      s.send(UploadsMessage.ClickedStartUpload())
        .send(UploadsMessage.ClickedStartUpload())
        .send(UploadsMessage.ClickedCancelUpload({ uploadId: 0 }));
      expect(s.interrupted.map((command) => command.args)).toEqual([
        firstUpload.args,
      ]);
      s.expectExact(secondUpload).resolve(
        UploadFile,
        UploadsMessage.CompletedUploadFile({ uploadId: 1 })
      );
      expect(s.model.uploads.map((upload) => upload.status)).toEqual([
        "Cancelled",
        "Done",
      ]);
      s.expectNone();
    });
  });

  it("cancel all interrupts every running upload and only those", async () => {
    await runStory(ExUploads, {}, (s) => {
      s.send(UploadsMessage.ClickedStartUpload())
        .send(UploadsMessage.ClickedStartUpload())
        .resolve(
          secondUpload,
          UploadsMessage.CompletedUploadFile({ uploadId: 1 })
        )
        .send(UploadsMessage.ClickedCancelAllUploads());
      expect(s.interrupted.map((command) => command.args)).toEqual([
        firstUpload.args,
      ]);
      expect(s.model.uploads.map((upload) => upload.status)).toEqual([
        "Cancelled",
        "Done",
      ]);
      s.expectNone();
    });
  });

  it("restarting a cancelled upload reuses its id and file", async () => {
    await runStory(ExUploads, {}, (s) => {
      s.send(UploadsMessage.ClickedStartUpload())
        .send(UploadsMessage.ClickedCancelUpload({ uploadId: 0 }))
        .send(UploadsMessage.ClickedRestartUpload({ uploadId: 0 }));
      expect(s.model.uploads.map((upload) => upload.status)).toEqual([
        "Uploading",
      ]);
      s.expectExact(firstUpload).resolve(
        UploadFile,
        UploadsMessage.CompletedUploadFile({ uploadId: 0 })
      );
      expect(s.model.uploads.map((upload) => upload.status)).toEqual(["Done"]);
      s.expectNone();
    });
  });
});

describe("uploads Scene", () => {
  it("the initial view shows the start button and an empty state", async () => {
    await runScene(ExUploads, {}, (scene) => {
      scene
        .expect(Locator.tag("h1"))
        .toHaveText("File Uploads")
        .expect(Locator.text("Upload a file"))
        .toExist()
        .expect(Locator.text("Nothing here yet. Start an upload."))
        .toExist()
        .expect(Locator.text("Cancel all"))
        .toBeAbsent();
    });
  });

  it("starting an upload shows an Uploading row with a cancel button", async () => {
    await runScene(ExUploads, {}, (scene) => {
      scene
        .click("Upload a file")
        .expect(Locator.text("vacation-photos.zip"))
        .toExist()
        .expect(Locator.text("Uploading"))
        .toExist()
        .expect(Locator.attr("aria-label", "Cancel upload 0"))
        .toExist()
        .resolve(
          UploadFile,
          UploadsMessage.CompletedUploadFile({ uploadId: 0 })
        )
        .expect(Locator.text("Done"))
        .toExist();
    });
  });

  it("cancelling an upload marks it Cancelled and offers a restart", async () => {
    await runScene(ExUploads, {}, (scene) => {
      scene
        .click("Upload a file")
        .click(Locator.attr("aria-label", "Cancel upload 0"))
        .expect(Locator.text("Cancelled"))
        .toExist()
        .click(Locator.attr("aria-label", "Restart upload 0"))
        .expect(Locator.text("Uploading"))
        .toExist()
        .resolve(
          UploadFile,
          UploadsMessage.CompletedUploadFile({ uploadId: 0 })
        )
        .expect(Locator.text("Done"))
        .toExist();
    });
  });

  it("the cancel all button appears only while an upload is running", async () => {
    await runScene(ExUploads, {}, (scene) => {
      scene
        .click("Upload a file")
        .expect(Locator.text("Cancel all"))
        .toExist()
        .click("Cancel all")
        .expect(Locator.text("Cancel all"))
        .toBeAbsent()
        .expect(Locator.text("Cancelled"))
        .toExist();
    });
  });
});

// -----------------------------------------------------------------------------
// Snake: clock subscription, keyboard shortcuts, growth and collision
// -----------------------------------------------------------------------------

type SnakeDirection = "Up" | "Down" | "Left" | "Right";
type SnakeGameState = "NotStarted" | "Playing" | "Paused" | "GameOver";
interface SnakeCell {
  readonly x: number;
  readonly y: number;
}

const GRID = 20;
const POINTS_PER_APPLE = 10;

const moveCell = (cell: SnakeCell, direction: SnakeDirection): SnakeCell => {
  if (direction === "Up") {
    return { x: cell.x, y: cell.y - 1 };
  }
  if (direction === "Down") {
    return { x: cell.x, y: cell.y + 1 };
  }
  if (direction === "Left") {
    return { x: cell.x - 1, y: cell.y };
  }
  return { x: cell.x + 1, y: cell.y };
};

const isOpposite = (a: SnakeDirection, b: SnakeDirection): boolean =>
  (a === "Up" && b === "Down") ||
  (a === "Down" && b === "Up") ||
  (a === "Left" && b === "Right") ||
  (a === "Right" && b === "Left");

const sameCell = (a: SnakeCell, b: SnakeCell): boolean =>
  a.x === b.x && a.y === b.y;

const inSnake = (snake: readonly SnakeCell[], cell: SnakeCell): boolean =>
  snake.some((part) => sameCell(part, cell));

const hasCollision = (snake: readonly SnakeCell[]): boolean => {
  const [head, ...body] = snake;
  if (head === undefined) {
    return true;
  }
  return (
    head.x < 0 ||
    head.y < 0 ||
    head.x >= GRID ||
    head.y >= GRID ||
    body.some((part) => sameCell(part, head))
  );
};

const firstFreeCell = (snake: readonly SnakeCell[]): SnakeCell => {
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const cell = { x, y };
      if (!inSnake(snake, cell)) {
        return cell;
      }
    }
  }
  return { x: 0, y: 0 };
};

const statusText = (gameState: SnakeGameState): string => {
  if (gameState === "NotStarted") {
    return "Press SPACE to start";
  }
  if (gameState === "Playing") {
    return "Playing - SPACE to pause";
  }
  if (gameState === "Paused") {
    return "Paused - SPACE to continue";
  }
  return "Game Over - Press R to restart";
};

const cellClass = (
  cell: SnakeCell,
  snake: readonly SnakeCell[],
  apple: SnakeCell
): string => {
  const [head] = snake;
  if (head !== undefined && sameCell(cell, head)) {
    return "head";
  }
  if (inSnake(snake, cell)) {
    return "body";
  }
  if (sameCell(cell, apple)) {
    return "apple";
  }
  return "empty";
};

const CellSchema = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const DirectionSchema = Schema.Literals(["Up", "Down", "Left", "Right"]);
const GameStateSchema = Schema.Literals([
  "NotStarted",
  "Playing",
  "Paused",
  "GameOver",
]);

const SnakeGameMessage = TaggedEnum({
  CompletedApple: { position: CellSchema },
  PressedKey: { key: Schema.String },
  TickedClock: {},
});

const GenerateApple = Command.make(
  "ExGenerateApple",
  { args: { snake: Schema.Array(CellSchema) } },
  ({ snake }) => Effect.succeed(firstFreeCell(snake))
);

const requestApple = (snake: SnakeCell[]) =>
  Command.map(GenerateApple.make({ snake }), (position) =>
    SnakeGameMessage.CompletedApple({ position })
  );

const START_SNAKE: SnakeCell[] = [{ x: 10, y: 10 }];

const tickInterval = (points: number): number => Math.max(50, 150 - points);

const MOVE_KEYS: readonly (readonly [string, SnakeDirection])[] = [
  ["ArrowUp", "Up"],
  ["ArrowDown", "Down"],
  ["ArrowLeft", "Left"],
  ["ArrowRight", "Right"],
  ["w", "Up"],
  ["s", "Down"],
  ["a", "Left"],
  ["d", "Right"],
];
const MOVE_OF = new Map<string, SnakeDirection>(
  MOVE_KEYS.map(([key, direction]) => [key, direction])
);

const NEXT_ON_SPACE: Record<SnakeGameState, SnakeGameState> = {
  GameOver: "GameOver",
  NotStarted: "Playing",
  Paused: "Playing",
  Playing: "Paused",
};

const ExSnakeGame = defineComponent({
  message: SnakeGameMessage,
  model: Schema.Struct({
    apple: CellSchema,
    direction: DirectionSchema,
    gameState: GameStateSchema,
    highScore: Schema.Number,
    nextDirection: DirectionSchema,
    points: Schema.Number,
    snake: Schema.Array(CellSchema),
  }),
  name: "ExSnakeGame",
}).make({
  init: ($) =>
    $.set({
      apple: { x: 15, y: 15 },
      direction: "Right",
      gameState: "NotStarted",
      highScore: 0,
      nextDirection: "Right",
      points: 0,
      snake: START_SNAKE,
    }).run(requestApple(START_SNAKE)),
  subscriptions: ({ model }) => [
    model.gameState === "Playing" &&
      Subscription.make("gameClock", tickInterval(model.points), (interval) =>
        Stream.tick(interval).pipe(
          Stream.drop(1),
          Stream.map(() => SnakeGameMessage.TickedClock())
        )
      ),
    DomSubscription.shortcuts([
      ...MOVE_KEYS.map(([key]) => ({
        key,
        message: SnakeGameMessage.PressedKey({ key }),
        repeat: true as const,
      })),
      {
        key: " ",
        message: SnakeGameMessage.PressedKey({ key: " " }),
        repeat: true as const,
      },
      {
        key: "r",
        message: SnakeGameMessage.PressedKey({ key: "r" }),
        repeat: true as const,
      },
    ]),
  ],
  update: {
    CompletedApple: ($, { position }) => $.evolve({ apple: position }),
    PressedKey: ($, { key }) => {
      const direction = MOVE_OF.get(key);
      if (direction !== undefined) {
        return $.model.gameState === "Playing" &&
          !isOpposite($.model.direction, direction)
          ? $.evolve({ nextDirection: direction })
          : $.model;
      }
      if (key === " ") {
        return $.evolve({ gameState: (state) => NEXT_ON_SPACE[state] });
      }
      if (key === "r") {
        return $.set({
          apple: $.model.apple,
          // SAFETY: "Right" is an exact member of the Direction literals
          direction: "Right" as SnakeDirection,
          // SAFETY: "NotStarted" is an exact member of the GameState literals
          gameState: "NotStarted" as SnakeGameState,
          highScore: $.model.highScore,
          // SAFETY: "Right" is an exact member of the Direction literals
          nextDirection: "Right" as SnakeDirection,
          points: 0,
          snake: START_SNAKE,
        }).run(requestApple(START_SNAKE));
      }
      return $.model;
    },
    TickedClock: ($) => {
      // oxlint-disable-next-line eslint/curly -- single-return guard clauses stay flat in this update
      if ($.model.gameState !== "Playing") return $.model;
      const [head] = $.model.snake;
      // oxlint-disable-next-line eslint/curly -- single-return guard clauses stay flat in this update
      if (head === undefined) return $.model;
      const direction = isOpposite($.model.direction, $.model.nextDirection)
        ? $.model.direction
        : $.model.nextDirection;
      const nextHead = moveCell(head, direction);
      const willEat = sameCell(nextHead, $.model.apple);
      const snake = willEat
        ? [nextHead, ...$.model.snake]
        : [nextHead, ...$.model.snake.slice(0, -1)];
      if (hasCollision(snake)) {
        return $.evolve({
          // SAFETY: "GameOver" is an exact member of the GameState literals
          gameState: "GameOver" as SnakeGameState,
          highScore: Math.max($.model.points, $.model.highScore),
        });
      }
      const next = {
        ...$.model,
        direction,
        points: willEat ? $.model.points + POINTS_PER_APPLE : $.model.points,
        snake,
      };
      return willEat ? $.set(next).run(requestApple(snake)) : next;
    },
  },
  view: (_h, model) => (
    <div>
      <h1>Snake Game</h1>
      <p>{`Score: ${model.points}`}</p>
      <p>{`High Score: ${model.highScore}`}</p>
      <p>{statusText(model.gameState)}</p>
      <div>
        {Array.from({ length: GRID }, (_row, y) => (
          <div>
            {Array.from({ length: GRID }, (_cell, x) => {
              const cell = { x, y };
              return <div class={cellClass(cell, model.snake, model.apple)} />;
            })}
          </div>
        ))}
      </div>
      <div>
        <p>Use ARROW KEYS or WASD to move</p>
        <p>SPACE to pause/start</p>
        <p>R to restart</p>
      </div>
    </div>
  ),
});

const playingSnake = {
  apple: { x: 15, y: 15 },
  // SAFETY: "Right" is an exact member of the Direction literals
  direction: "Right" as SnakeDirection,
  // SAFETY: "Playing" is an exact member of the GameState literals
  gameState: "Playing" as SnakeGameState,
  highScore: 0,
  // SAFETY: "Right" is an exact member of the Direction literals
  nextDirection: "Right" as SnakeDirection,
  points: 0,
  snake: [{ x: 10, y: 10 }],
};

describe("snake Story", () => {
  it("starts NotStarted and generates the first apple", async () => {
    await runStory(ExSnakeGame, {}, (s) => {
      expect(s.model.gameState).toBe("NotStarted");
      expect(s.model.snake).toEqual(START_SNAKE);
      s.expectExact(GenerateApple.make({ snake: START_SNAKE })).resolve(
        GenerateApple,
        { x: 3, y: 4 }
      );
      expect(s.model.apple).toEqual({ x: 3, y: 4 });
      s.expectNone();
    });
  });

  it("listens to the keyboard in every state and to the clock only while playing", async () => {
    const keyboard = `@ilha/model/document:"keydown"`;
    await runStory(ExSnakeGame, {}, (s) => {
      // SAFETY: "NotStarted" is an exact member of the GameState literals
      s.given({ ...playingSnake, gameState: "NotStarted" as SnakeGameState });
      expect(s.subscriptions).toEqual([keyboard]);
      s.given(playingSnake);
      expect(s.subscriptions).toEqual(["gameClock:150", keyboard]);
      // SAFETY: "Paused" is an exact member of the GameState literals
      s.given({ ...playingSnake, gameState: "Paused" as SnakeGameState });
      expect(s.subscriptions).toEqual([keyboard]);
      // SAFETY: "GameOver" is an exact member of the GameState literals
      s.given({
        ...playingSnake,
        gameState: "GameOver" as SnakeGameState,
        points: 40,
      });
      expect(s.subscriptions).toEqual([keyboard]);
    });
  });

  it("steers with an arrow key and moves on the next tick", async () => {
    await runStory(ExSnakeGame, {}, (s) => {
      s.given(playingSnake).send(
        SnakeGameMessage.PressedKey({ key: "ArrowUp" })
      );
      expect(s.model.nextDirection).toBe("Up");
      s.subscription("gameClock:150", SnakeGameMessage.TickedClock());
      expect(s.model.direction).toBe("Up");
      expect(s.model.snake).toEqual([{ x: 10, y: 9 }]);
      s.expectNone();
    });
  });

  it("ignores a reversal and keys the game doesn't handle", async () => {
    await runStory(ExSnakeGame, {}, (s) => {
      s.given(playingSnake)
        .send(SnakeGameMessage.PressedKey({ key: "ArrowLeft" }))
        .subscription("gameClock:150", SnakeGameMessage.TickedClock());
      // Left is opposite Right, so the snake keeps moving right.
      expect(s.model.direction).toBe("Right");
      expect(s.model.snake).toEqual([{ x: 11, y: 10 }]);
      s.send(SnakeGameMessage.PressedKey({ key: "q" }));
      expect(s.model.nextDirection).toBe("Right");
      // Steering does nothing before the game starts.
      // SAFETY: "NotStarted" is an exact member of the GameState literals
      s.given({
        ...playingSnake,
        gameState: "NotStarted" as SnakeGameState,
      }).send(SnakeGameMessage.PressedKey({ key: "ArrowUp" }));
      expect(s.model.nextDirection).toBe("Right");
      s.expectNone();
    });
  });

  it("eating an apple grows the snake, adds points, and requests a new apple", async () => {
    await runStory(ExSnakeGame, {}, (s) => {
      s.given({ ...playingSnake, apple: { x: 11, y: 10 } }).subscription(
        "gameClock:150",
        SnakeGameMessage.TickedClock()
      );
      expect(s.model.snake).toEqual([
        { x: 11, y: 10 },
        { x: 10, y: 10 },
      ]);
      expect(s.model.points).toBe(10);
      s.expectExact(GenerateApple.make({ snake: s.model.snake })).resolve(
        GenerateApple,
        { x: 5, y: 5 }
      );
      expect(s.model.apple).toEqual({ x: 5, y: 5 });
      s.expectNone();
    });
  });

  it("hitting a wall ends the game and keeps the high score", async () => {
    await runStory(ExSnakeGame, {}, (s) => {
      s.given({
        ...playingSnake,
        highScore: 20,
        points: 30,
        snake: [{ x: 19, y: 10 }],
      }).subscription("gameClock:120", SnakeGameMessage.TickedClock());
      expect(s.model.gameState).toBe("GameOver");
      expect(s.model.highScore).toBe(30);
      s.expectNone();
    });
  });

  it("running into itself ends the game", async () => {
    await runStory(ExSnakeGame, {}, (s) => {
      s.given({
        ...playingSnake,
        // SAFETY: "Up" is an exact member of the Direction literals
        direction: "Up" as SnakeDirection,
        // SAFETY: "Up" is an exact member of the Direction literals
        nextDirection: "Up" as SnakeDirection,
        snake: [
          { x: 1, y: 1 },
          { x: 1, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
      }).subscription("gameClock:150", SnakeGameMessage.TickedClock());
      expect(s.model.gameState).toBe("GameOver");
      s.expectNone();
    });
  });

  it("SPACE pauses and resumes, and R restarts with a fresh apple", async () => {
    await runStory(ExSnakeGame, {}, (s) => {
      // SAFETY: "NotStarted" is an exact member of the GameState literals
      s.given({
        ...playingSnake,
        gameState: "NotStarted" as SnakeGameState,
      }).subscription(
        `@ilha/model/document:"keydown"`,
        SnakeGameMessage.PressedKey({ key: " " })
      );
      expect(s.model.gameState).toBe("Playing");
      s.send(SnakeGameMessage.PressedKey({ key: " " }));
      expect(s.model.gameState).toBe("Paused");
      s.send(SnakeGameMessage.PressedKey({ key: " " }));
      expect(s.model.gameState).toBe("Playing");
      // SAFETY: "GameOver" is an exact member of the GameState literals
      s.given({
        ...playingSnake,
        gameState: "GameOver" as SnakeGameState,
        points: 50,
      }).send(SnakeGameMessage.PressedKey({ key: "r" }));
      expect(s.model.gameState).toBe("NotStarted");
      expect(s.model.points).toBe(0);
      expect(s.model.snake).toEqual(START_SNAKE);
      s.expectExact(GenerateApple.make({ snake: START_SNAKE })).resolve(
        GenerateApple,
        { x: 0, y: 0 }
      );
      expect(s.model.apple).toEqual({ x: 0, y: 0 });
      s.expectNone();
    });
  });
});

describe("snake Scene", () => {
  // SAFETY: "NotStarted" is an exact member of the GameState literals
  const base = { ...playingSnake, gameState: "NotStarted" as SnakeGameState };

  it("shows the heading, scores, and start prompt", async () => {
    await runScene(ExSnakeGame, {}, (scene) => {
      scene
        .given(base)
        .expect(Locator.tag("h1"))
        .toHaveText("Snake Game")
        .expect(Locator.text("Score: 0"))
        .toExist()
        .expect(Locator.text("High Score: 0"))
        .toExist()
        .expect(Locator.text("Press SPACE to start"))
        .toExist()
        .expect(Locator.text("Use ARROW KEYS or WASD to move"))
        .toExist();
    });
  });

  it("shows the paused and game-over prompts with the scores", async () => {
    await runScene(ExSnakeGame, {}, (scene) => {
      // SAFETY: "Paused" is an exact member of the GameState literals
      scene
        .given({ ...base, gameState: "Paused" as SnakeGameState })
        .expect(Locator.text("Paused - SPACE to continue"))
        .toExist()
        // SAFETY: "GameOver" is an exact member of the GameState literals
        .given({
          ...base,
          gameState: "GameOver" as SnakeGameState,
          highScore: 60,
          points: 50,
        })
        .expect(Locator.text("Game Over - Press R to restart"))
        .toExist()
        .expect(Locator.text("Score: 50"))
        .toExist()
        .expect(Locator.text("High Score: 60"))
        .toExist();
    });
  });
});

// -----------------------------------------------------------------------------
// Launch CartProvider/Shop: shared state over real mounts
// -----------------------------------------------------------------------------

const CartMessage = TaggedEnum({ RequestedAddItem: {} });

const ExCartProviderDef = defineComponent({
  message: CartMessage,
  model: Schema.Struct({ count: Schema.Number }),
  name: "ExCartProvider",
  shares: {
    receives: ["RequestedAddItem"],
    value: (model) => {
      // The provider's model holds the count the readers show.
      // SAFETY: the provider model holds the count the readers show
      const state = model as { readonly count: number };
      return { count: state.count };
    },
  },
});

// The frozen Headless.Any erases Events to any, which a concrete headless
// component (Events never) is not assignable to through the definition's
// overloaded update. The cast only adjusts the type: the value (and its
// definition identity for owner lookup) is unchanged.
// SAFETY: the cast only adjusts the type per the comment above; the value and its definition identity are unchanged
// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- Headless.Any erases Events to any, which the concrete component cannot satisfy directly
const ExCartProvider = ExCartProviderDef.make({
  init: () => ({ count: 0 }),
  update: {
    RequestedAddItem: ($) => $.evolve({ count: $.model.count + 1 }),
  },
}) as unknown as Headless.Any;

const ExCartCount = defineComponent({
  message: Schema.Never,
  model: Schema.Null,
  name: "ExCartCount",
  reads: { cart: ExCartProvider },
}).make({
  init: () => null,
  update: ($) => $,
  view: (h) => {
    // SAFETY: the provider model holds the count the readers show
    const cart = h.reads.cart as { readonly count: number };
    return <output>{`${cart.count} in cart`}</output>;
  },
});

const AddToCartMessage = TaggedEnum({ ClickedAdd: {} });

const ExAddToCart = defineComponent({
  message: AddToCartMessage,
  model: Schema.Null,
  name: "ExAddToCart",
}).make({
  init: () => null,
  update: {
    ClickedAdd: ($) => $.send(ExCartProvider, CartMessage.RequestedAddItem()),
  },
  view: (h) => (
    <button onclick={h.send(AddToCartMessage.ClickedAdd())}>Add to cart</button>
  ),
});

const ExShop = defineComponent({
  message: Schema.Never,
  model: Schema.Null,
  name: "ExShop",
}).make({
  init: () => null,
  update: ($) => $,
  view: () => (
    <ExCartProvider
      view={() => (
        <main>
          <ExCartCount />
          <article>
            <h3>Notebook</h3>
            <ExAddToCart />
          </article>
        </main>
      )}
    />
  ),
});

describe("CartProvider/Shop", () => {
  it("shares the cart count with readers and takes sends from children", async () => {
    await runPlay(ExShop, {}, (play) =>
      Effect.gen(function* scenario() {
        yield* play.expect(Locator.text("0 in cart")).toExist();
        yield* play.click(Locator.text("Add to cart"));
        // The send lands on the provider, not the root, so the tracker's
        // root-update check marks the click ignored.
        yield* play.expectIgnored();
        yield* play.expect(Locator.text("1 in cart")).toExist();
        yield* play.click(Locator.text("Add to cart"));
        yield* play.expectIgnored();
        yield* play.expect(Locator.text("2 in cart")).toExist();
      })
    );
  });
});

// -----------------------------------------------------------------------------
// Launch Posts with SearchPosts: component queries over real mounts
// -----------------------------------------------------------------------------

const Post = Schema.Struct({ id: Schema.String, title: Schema.String });
type PostT = typeof Post.Type;

const POSTS: PostT[] = [
  { id: "1", title: "Foldkit Joins Effect" },
  { id: "2", title: "Foldkit 0.x becomes Effect UI" },
];

interface PostsApiService {
  readonly search: (search: string) => Effect.Effect<PostT[], string>;
}
const PostsApi = Context.Service<PostsApiService, PostsApiService>()(
  "ExPostsApi"
);

class SearchPosts extends Query.Service<SearchPosts>()("ExSearchPosts", {
  args: { search: Schema.String },
  error: Schema.String,
  staleTime: "1 minute",
  success: Schema.Array(Post),
}) {
  static readonly layer: Layer.Layer<SearchPosts, never, PostsApiService> =
    this.toLayer(
      Effect.map(
        // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.map is a data-first dual, not Array#map; the second arg is the mapper
        PostsApi,
        (api) =>
          ({ search }: { readonly search: string }) =>
            api.search(search)
      )
    );
}

const PostsMessage = TaggedEnum({ UpdatedSearch: { search: Schema.String } });

const ExPostsDef = defineComponent({
  message: PostsMessage,
  model: Schema.Struct({ search: Schema.String }),
  name: "ExPosts",
  queries: {
    posts: {
      args: ({ model }: QueryArgsContext<unknown, unknown, unknown>) => {
        // The framework runs args with the component's Model.
        // SAFETY: args runs with the component model
        const current: { readonly search: string } = model as {
          readonly search: string;
        };
        return { search: current.search };
      },
      debounce: "120 millis",
      query: SearchPosts,
    },
  },
});

const ExPosts = ExPostsDef.make({
  init: () => ({ search: "" }),
  update: {
    UpdatedSearch: ($, { search }) => $.evolve({ search }),
  },
  view: (h, model) => (
    <div>
      <input
        data-testid="search"
        aria-label="Search posts"
        value={model.search}
        oninput={h.send((event) => {
          // Real input events expose the field on their target.
          // SAFETY: handlers receive real DOM events at runtime
          const domEvent = event as Event;
          // SAFETY: oninput fires on the bound search field
          const target = domEvent.target as HTMLInputElement;
          return PostsMessage.UpdatedSearch({ search: target.value });
        })}
      />
      {AsyncResult.match(h.queries.posts, {
        onFailure: () => <p>Could not load posts</p>,
        onInitial: () => <p>Loading posts</p>,
        onSuccess: ({ value, waiting }) => (
          <ul aria-busy={String(waiting)}>
            {value.map((post) => (
              <li key={post.id}>{post.title}</li>
            ))}
          </ul>
        ),
      })}
    </div>
  ),
});

const livePosts = (
  search: (search: string) => Effect.Effect<PostT[], string>
) =>
  Component.provide(
    Component.provide(
      // The frozen provide overloads constrain the component to
      // ModelComponent<any, any, any, any>, which no concrete component
      // satisfies through the definition's Model-conditional update. The
      // cast only adjusts the type; the R channel stays precise.
      // SAFETY: erasure keeps the runtime component; the query harness reattaches the SearchPosts contract
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions, typescript/no-explicit-any -- provide overloads need the all-any shape with a precise R
      ExPosts as unknown as ModelComponent<any, any, SearchPosts, any>,
      SearchPosts.layer
    ),
    Layer.succeed(PostsApi, { search })
  );

const searchPosts = (search: string): Effect.Effect<PostT[], string> =>
  Effect.succeed(
    POSTS.filter((post) =>
      post.title.toLowerCase().includes(search.toLowerCase())
    )
  ).pipe(Effect.delay("120 millis"));

describe("Posts with SearchPosts", () => {
  it("shows every post, then only the matches after a debounced search", async () => {
    await runPlay(livePosts(searchPosts), {}, (play) =>
      Effect.gen(function* scenario() {
        yield* play.expect(Locator.text("Foldkit Joins Effect")).toExist();
        yield* play
          .expect(Locator.text("Foldkit 0.x becomes Effect UI"))
          .toExist();
        yield* play.type(Locator.testId("search"), "becomes");
        yield* play
          .expect(Locator.text("Foldkit 0.x becomes Effect UI"))
          .toExist();
        yield* play.expect(Locator.text("Foldkit Joins Effect")).toBeAbsent();
      })
    );
  });

  it("reports a failed search", async () => {
    await runPlay(
      livePosts(() => Effect.fail("offline")),
      {},
      (play) =>
        Effect.gen(function* scenario() {
          yield* play.expect(Locator.text("Could not load posts")).toExist();
        })
    );
  });
});

// -----------------------------------------------------------------------------
// Launch Disclosure/Details: headless parts over real mounts
// -----------------------------------------------------------------------------

const DisclosureMessage = TaggedEnum({ ClickedTrigger: {} });

const ExDisclosureDef = defineComponent({
  message: DisclosureMessage,
  model: Schema.Struct({ isOpen: Schema.Boolean }),
  name: "ExDisclosure",
});

const ExDisclosure = ExDisclosureDef.make({
  init: () => ({ isOpen: false }),
  parts: (p, model) => ({
    isOpen: model.isOpen,
    panel: p.part("div", () => ({ id: p.id("panel") })),
    trigger: p.part("button", () => ({
      "aria-controls": p.id("panel"),
      "aria-expanded": String(model.isOpen),
      onclick: p.send(DisclosureMessage.ClickedTrigger()),
      type: "button",
    })),
  }),
  update: {
    ClickedTrigger: ($) => $.evolve({ isOpen: (open) => !open }),
  },
});

const ExDetails = defineComponent({
  message: Schema.Never,
  model: Schema.Null,
  name: "ExDetails",
}).make({
  init: () => null,
  update: ($) => $,
  view: (h) => (
    <ExDisclosure
      view={(disclosure) => (
        <section>
          {disclosure.trigger(h("button", null, "Shipping"))}
          {disclosure.isOpen
            ? disclosure.panel(h("div", null, "Arrives in 3 days."))
            : null}
        </section>
      )}
    />
  ),
});

describe("Disclosure/Details", () => {
  it("opens the panel its trigger controls", async () => {
    await runPlay(ExDetails, {}, (play) =>
      Effect.gen(function* scenario() {
        yield* play.expect(Locator.text("Arrives in 3 days.")).toBeAbsent();
        yield* play.click(Locator.text("Shipping"));
        // The toggle lands on the headless child, not the root, so the
        // tracker's root-update check marks the click ignored.
        yield* play.expectIgnored();
        yield* play.expect(Locator.text("Arrives in 3 days.")).toExist();
        yield* play.expect(Locator.attr("aria-expanded", "true")).toExist();
        yield* play.click(Locator.text("Shipping"));
        yield* play.expectIgnored();
        yield* play.expect(Locator.text("Arrives in 3 days.")).toBeAbsent();
      })
    );
  });
});
