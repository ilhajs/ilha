/**
 * The image loader, for loading an image the page doesn't show yet.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/**
 * An image to load, as the `<img>` attributes of the same names.
 */
export interface ImageSource {
  /** The image URL. */
  readonly src?: string | undefined;
  /** Candidate sources with width or density descriptors. */
  readonly srcSet?: string | undefined;
  /** The sizes each source applies to. */
  readonly sizes?: string | undefined;
  /** Whether to fetch with CORS. */
  readonly crossOrigin?: "anonymous" | "use-credentials" | undefined;
  /** The referrer policy for the fetch. */
  readonly referrerPolicy?: string | undefined;
}

/**
 * Loads images the page doesn't show, such as to show an `<img>` only once
 * its source has loaded.
 *
 * **Details**
 *
 * `load` settles with `"loaded"` or `"error"`, and interrupting it drops
 * the load. The browser layer loads in a detached `<img>` of its document.
 * The default never settles, so on a host without a document an image stays
 * loading. A test settles loads with `TestImages` from `@ilha/model/test`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the interface is the service contract, the const its Reference; intentional merging like ilha's `Fragment`.
export interface Images {
  /** Load `source`; settles with `"loaded"` or `"error"`. */
  readonly load: (source: ImageSource) => Effect.Effect<"loaded" | "error">;
}

/** A loader whose loads never settle: the default without a document. */
const pending: Images = { load: () => Effect.never };

/**
 * The image loader. It defaults to one whose loads never settle.
 */
export const Images: Context.Reference<Images> = Context.Reference<Images>(
  "@ilha/model/DomImages/Images",
  { defaultValue: () => pending }
);

/**
 * An `Images` service that loads in a detached `<img>` of `document`. The
 * image is never attached, so it leaves no DOM behind. When the image is
 * already `complete` it settles at once with `"loaded"` for pixels and
 * `"error"` otherwise; interrupting the load drops it.
 */
export const makeBrowserImages = (document: Document): Images => ({
  load: (source) =>
    Effect.callback((resume) => {
      const image = document.createElement("img");
      const settle = (status: "loaded" | "error") =>
        resume(Effect.succeed(status));
      if (source.referrerPolicy !== undefined) {
        image.referrerPolicy = source.referrerPolicy;
      }
      image.crossOrigin = source.crossOrigin ?? null;
      if (source.sizes !== undefined) {
        image.sizes = source.sizes;
      }
      if (source.srcSet !== undefined) {
        image.srcset = source.srcSet;
      }
      if (source.src !== undefined) {
        image.src = source.src;
      }
      if (image.complete) {
        return settle(image.naturalWidth > 0 ? "loaded" : "error");
      }
      const onLoad = (): void => settle("loaded");
      const onError = (): void => settle("error");
      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);
      return Effect.sync(() => {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
      });
    }),
});

/**
 * Provide `Images` from `document`'s detached images.
 */
export const browserLayer = (document: Document): Layer.Layer<Images> =>
  // SAFETY: `Context.add` stores the service under the reference's key, which `Context.get(Images)` reads back; the `never` is only the reference's missing input type.
  Layer.succeedContext(
    Context.empty().pipe(
      Context.add(Images, makeBrowserImages(document))
    ) as Context.Context<Images>
  );
