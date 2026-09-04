/* oxlint-disable typescript/no-namespace -- TS JSX factories require an exported JSX namespace */
import type { AtomHandle, PropBag, View } from "./types.ts";

export namespace JSX {
  export type Element = View;
  export type ElementType =
    | string
    | ((
        props: PropBag
      ) =>
        | View
        | Promise<View | undefined>
        | Generator<View, View | undefined, View>);

  export interface ElementChildrenAttribute {
    children: View;
  }

  /** Scalar attribute value (booleans become presence/absence). */
  type Attr = string | number | boolean | null | undefined;

  /** Values that can bind through `value` / `checked` / `selected`. */
  type Bindable<T> = T | AtomHandle<T>;

  type StyleValue =
    | string
    | Readonly<Record<string, string | number | null | undefined>>
    | null
    | undefined;

  type Targeted<
    Target extends globalThis.EventTarget,
    E extends globalThis.Event,
  > = Omit<E, "currentTarget"> & {
    readonly currentTarget: Target;
  };

  type Handler<
    Target extends globalThis.EventTarget,
    E extends globalThis.Event,
  > = {
    // Bivariant so per-tag handlers stay assignable to the catch-all index
    // signature. The `void` return accepts any handler result (numbers,
    // Effects, promises) while keeping the type honest.
    bivarianceHack: (event: Targeted<Target, E>) => void;
  }["bivarianceHack"];

  /** Lowercase DOM event props Ilha binds at runtime. */
  interface EventProps<Target extends globalThis.EventTarget> {
    onclick?: Handler<Target, globalThis.MouseEvent>;
    ondblclick?: Handler<Target, globalThis.MouseEvent>;
    onmousedown?: Handler<Target, globalThis.MouseEvent>;
    onmouseup?: Handler<Target, globalThis.MouseEvent>;
    onmouseenter?: Handler<Target, globalThis.MouseEvent>;
    onmouseleave?: Handler<Target, globalThis.MouseEvent>;
    onmousemove?: Handler<Target, globalThis.MouseEvent>;
    onmouseover?: Handler<Target, globalThis.MouseEvent>;
    onmouseout?: Handler<Target, globalThis.MouseEvent>;
    oncontextmenu?: Handler<Target, globalThis.MouseEvent>;
    onpointerdown?: Handler<Target, globalThis.PointerEvent>;
    onpointerup?: Handler<Target, globalThis.PointerEvent>;
    onpointermove?: Handler<Target, globalThis.PointerEvent>;
    onpointerenter?: Handler<Target, globalThis.PointerEvent>;
    onpointerleave?: Handler<Target, globalThis.PointerEvent>;
    onpointercancel?: Handler<Target, globalThis.PointerEvent>;
    ontouchstart?: Handler<Target, globalThis.TouchEvent>;
    ontouchend?: Handler<Target, globalThis.TouchEvent>;
    ontouchmove?: Handler<Target, globalThis.TouchEvent>;
    ontouchcancel?: Handler<Target, globalThis.TouchEvent>;
    onkeydown?: Handler<Target, globalThis.KeyboardEvent>;
    onkeyup?: Handler<Target, globalThis.KeyboardEvent>;
    onkeypress?: Handler<Target, globalThis.KeyboardEvent>;
    onfocus?: Handler<Target, globalThis.FocusEvent>;
    onblur?: Handler<Target, globalThis.FocusEvent>;
    onfocusin?: Handler<Target, globalThis.FocusEvent>;
    onfocusout?: Handler<Target, globalThis.FocusEvent>;
    oninput?: Handler<Target, globalThis.Event>;
    onchange?: Handler<Target, globalThis.Event>;
    onsubmit?: Handler<Target, globalThis.SubmitEvent>;
    onreset?: Handler<Target, globalThis.Event>;
    oninvalid?: Handler<Target, globalThis.Event>;
    onscroll?: Handler<Target, globalThis.Event>;
    onwheel?: Handler<Target, globalThis.WheelEvent>;
    oncopy?: Handler<Target, globalThis.ClipboardEvent>;
    oncut?: Handler<Target, globalThis.ClipboardEvent>;
    onpaste?: Handler<Target, globalThis.ClipboardEvent>;
    ondrag?: Handler<Target, globalThis.DragEvent>;
    ondragend?: Handler<Target, globalThis.DragEvent>;
    ondragenter?: Handler<Target, globalThis.DragEvent>;
    ondragleave?: Handler<Target, globalThis.DragEvent>;
    ondragover?: Handler<Target, globalThis.DragEvent>;
    ondragstart?: Handler<Target, globalThis.DragEvent>;
    ondrop?: Handler<Target, globalThis.DragEvent>;
    onanimationstart?: Handler<Target, globalThis.AnimationEvent>;
    onanimationend?: Handler<Target, globalThis.AnimationEvent>;
    onanimationiteration?: Handler<Target, globalThis.AnimationEvent>;
    ontransitionend?: Handler<Target, globalThis.TransitionEvent>;
    onload?: Handler<Target, globalThis.Event>;
    onerror?: Handler<Target, globalThis.Event>;
  }

  type AriaProps = Partial<Record<`aria-${string}`, Attr>>;

  type DataProps = Partial<Record<`data-${string}`, Attr>>;

  /** Shared HTML attributes. Prefer `class` / `for`; `className` / `htmlFor` also work. */
  type HTMLAttributes<
    Target extends globalThis.EventTarget = globalThis.HTMLElement,
  > = EventProps<Target> &
    AriaProps &
    DataProps & {
      children?: View;
      key?: string | number;
      ref?: (el: (Target & globalThis.Element) | null) => void;
      // Class / identity
      class?: Attr;
      className?: Attr;
      id?: Attr;
      style?: StyleValue;
      title?: Attr;
      lang?: Attr;
      dir?: Attr;
      hidden?: Attr;
      tabindex?: number | string | null | undefined;
      role?: Attr;
      slot?: Attr;
      part?: Attr;
      // Common misc
      accesskey?: Attr;
      contenteditable?: Attr;
      draggable?: Attr;
      spellcheck?: Attr;
      translate?: Attr;
      inert?: Attr;
      popover?: Attr;
      autofocus?: Attr;
    };

  type AnchorHTMLAttributes = HTMLAttributes<HTMLAnchorElement> & {
    href?: Attr;
    target?: Attr;
    rel?: Attr;
    download?: Attr;
    hreflang?: Attr;
    ping?: Attr;
    referrerpolicy?: Attr;
    type?: Attr;
  };

  type AreaHTMLAttributes = HTMLAttributes<HTMLAreaElement> & {
    alt?: Attr;
    coords?: Attr;
    href?: Attr;
    hreflang?: Attr;
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- HTML area `shape` attribute
    shape?: Attr;
    target?: Attr;
    download?: Attr;
    rel?: Attr;
    referrerpolicy?: Attr;
  };

  type BaseHTMLAttributes = HTMLAttributes<HTMLBaseElement> & {
    href?: Attr;
    target?: Attr;
  };

  type BodyHTMLAttributes = HTMLAttributes<HTMLBodyElement>;

  type ButtonHTMLAttributes = HTMLAttributes<HTMLButtonElement> & {
    type?: "button" | "submit" | "reset" | string;
    value?: Bindable<string | number>;
    name?: Attr;
    disabled?: Attr;
    form?: Attr;
    formaction?: Attr;
    formenctype?: Attr;
    formmethod?: Attr;
    formnovalidate?: Attr;
    formtarget?: Attr;
  };

  type CanvasHTMLAttributes = HTMLAttributes<HTMLCanvasElement> & {
    width?: number | string;
    height?: number | string;
  };

  type DetailsHTMLAttributes = HTMLAttributes<HTMLDetailsElement> & {
    open?: Attr;
  };

  type DialogHTMLAttributes = HTMLAttributes<HTMLDialogElement> & {
    open?: Attr;
  };

  type EmbedHTMLAttributes = HTMLAttributes<HTMLEmbedElement> & {
    src?: Attr;
    type?: Attr;
    width?: number | string;
    height?: number | string;
  };

  type FieldsetHTMLAttributes = HTMLAttributes<HTMLFieldSetElement> & {
    disabled?: Attr;
    form?: Attr;
    name?: Attr;
  };

  type FormHTMLAttributes = HTMLAttributes<HTMLFormElement> & {
    action?: Attr;
    method?: Attr;
    enctype?: Attr;
    target?: Attr;
    novalidate?: Attr;
    autocomplete?: Attr;
    name?: Attr;
    rel?: Attr;
  };

  type HtmlHTMLAttributes = HTMLAttributes<HTMLHtmlElement> & {
    xmlns?: Attr;
  };

  type IframeHTMLAttributes = HTMLAttributes<HTMLIFrameElement> & {
    src?: Attr;
    srcdoc?: Attr;
    name?: Attr;
    width?: number | string;
    height?: number | string;
    allow?: Attr;
    allowfullscreen?: Attr;
    loading?: "eager" | "lazy" | string;
    referrerpolicy?: Attr;
    sandbox?: Attr;
  };

  type ImgHTMLAttributes = HTMLAttributes<HTMLImageElement> & {
    alt?: Attr;
    src?: Attr;
    srcset?: Attr;
    sizes?: Attr;
    width?: number | string;
    height?: number | string;
    loading?: "eager" | "lazy" | string;
    decoding?: "async" | "auto" | "sync" | string;
    crossorigin?: Attr;
    referrerpolicy?: Attr;
    usemap?: Attr;
  };

  type InputHTMLAttributes = HTMLAttributes<HTMLInputElement> & {
    type?: string;
    name?: Attr;
    value?: Bindable<string | number>;
    checked?: Bindable<boolean>;
    defaultValue?: string | number;
    defaultChecked?: boolean;
    placeholder?: Attr;
    required?: Attr;
    disabled?: Attr;
    readOnly?: Attr;
    readonly?: Attr;
    multiple?: Attr;
    min?: number | string;
    max?: number | string;
    minlength?: number | string;
    maxlength?: number | string;
    step?: number | string;
    pattern?: Attr;
    list?: Attr;
    size?: number | string;
    accept?: Attr;
    autocomplete?: Attr;
    capture?: Attr;
    form?: Attr;
    formaction?: Attr;
    formenctype?: Attr;
    formmethod?: Attr;
    formnovalidate?: Attr;
    formtarget?: Attr;
  };

  type LabelHTMLAttributes = HTMLAttributes<HTMLLabelElement> & {
    for?: Attr;
    htmlFor?: Attr;
    form?: Attr;
  };

  type LiHTMLAttributes = HTMLAttributes<HTMLLIElement> & {
    value?: number | string;
  };

  type LinkHTMLAttributes = HTMLAttributes<HTMLLinkElement> & {
    href?: Attr;
    rel?: Attr;
    type?: Attr;
    as?: Attr;
    media?: Attr;
    sizes?: Attr;
    crossorigin?: Attr;
    integrity?: Attr;
    referrerpolicy?: Attr;
    imagesrcset?: Attr;
    imagesizes?: Attr;
    disabled?: Attr;
  };

  type MapHTMLAttributes = HTMLAttributes<HTMLMapElement> & {
    name?: Attr;
  };

  type MetaHTMLAttributes = HTMLAttributes<HTMLMetaElement> & {
    charset?: Attr;
    content?: Attr;
    httpEquiv?: Attr;
    "http-equiv"?: Attr;
    name?: Attr;
    media?: Attr;
  };

  type MeterHTMLAttributes = HTMLAttributes<HTMLMeterElement> & {
    value?: number | string;
    min?: number | string;
    max?: number | string;
    low?: number | string;
    high?: number | string;
    optimum?: number | string;
  };

  type ObjectHTMLAttributes = HTMLAttributes<HTMLObjectElement> & {
    data?: Attr;
    type?: Attr;
    name?: Attr;
    width?: number | string;
    height?: number | string;
    form?: Attr;
  };

  type OlHTMLAttributes = HTMLAttributes<HTMLOListElement> & {
    reversed?: Attr;
    start?: number | string;
    type?: Attr;
  };

  type OptgroupHTMLAttributes = HTMLAttributes<HTMLOptGroupElement> & {
    disabled?: Attr;
    label?: Attr;
  };

  type OptionHTMLAttributes = HTMLAttributes<HTMLOptionElement> & {
    disabled?: Attr;
    label?: Attr;
    selected?: Bindable<boolean>;
    value?: string | number;
  };

  type OutputHTMLAttributes = HTMLAttributes<HTMLOutputElement> & {
    for?: Attr;
    htmlFor?: Attr;
    form?: Attr;
    name?: Attr;
  };

  type ProgressHTMLAttributes = HTMLAttributes<HTMLProgressElement> & {
    value?: number | string;
    max?: number | string;
  };

  type QuoteHTMLAttributes = HTMLAttributes<HTMLQuoteElement> & {
    cite?: Attr;
  };

  type ScriptHTMLAttributes = HTMLAttributes<HTMLScriptElement> & {
    src?: Attr;
    type?: Attr;
    async?: Attr;
    defer?: Attr;
    crossorigin?: Attr;
    integrity?: Attr;
    nomodule?: Attr;
    referrerpolicy?: Attr;
  };

  type SelectHTMLAttributes = HTMLAttributes<HTMLSelectElement> & {
    name?: Attr;
    value?: Bindable<string | number>;
    required?: Attr;
    disabled?: Attr;
    multiple?: Attr;
    size?: number | string;
    autocomplete?: Attr;
    form?: Attr;
  };

  type SourceHTMLAttributes = HTMLAttributes<HTMLSourceElement> & {
    src?: Attr;
    srcset?: Attr;
    sizes?: Attr;
    media?: Attr;
    type?: Attr;
    width?: number | string;
    height?: number | string;
  };

  type StyleHTMLAttributes = HTMLAttributes<HTMLStyleElement> & {
    media?: Attr;
    type?: Attr;
    blocked?: Attr;
  };

  type TableHTMLAttributes = HTMLAttributes<HTMLTableElement> & {
    width?: number | string;
  };

  type TdHTMLAttributes = HTMLAttributes<HTMLTableCellElement> & {
    colspan?: number | string;
    rowspan?: number | string;
    headers?: Attr;
  };

  type TextareaHTMLAttributes = HTMLAttributes<HTMLTextAreaElement> & {
    name?: Attr;
    value?: Bindable<string>;
    placeholder?: Attr;
    required?: Attr;
    disabled?: Attr;
    readOnly?: Attr;
    readonly?: Attr;
    rows?: number | string;
    cols?: number | string;
    maxlength?: number | string;
    minlength?: number | string;
    wrap?: Attr;
    autocomplete?: Attr;
    form?: Attr;
  };

  type ThHTMLAttributes = HTMLAttributes<HTMLTableCellElement> & {
    colspan?: number | string;
    rowspan?: number | string;
    headers?: Attr;
    scope?: Attr;
    abbr?: Attr;
  };

  type TimeHTMLAttributes = HTMLAttributes<HTMLTimeElement> & {
    datetime?: Attr;
  };

  type TrackHTMLAttributes = HTMLAttributes<HTMLTrackElement> & {
    src?: Attr;
    kind?: Attr;
    label?: Attr;
    srclang?: Attr;
    default?: Attr;
  };

  type VideoHTMLAttributes = HTMLAttributes<HTMLVideoElement> & {
    src?: Attr;
    poster?: Attr;
    width?: number | string;
    height?: number | string;
    autoplay?: Attr;
    controls?: Attr;
    loop?: Attr;
    muted?: Attr;
    playsinline?: Attr;
    preload?: Attr;
    crossorigin?: Attr;
  };

  type AudioHTMLAttributes = HTMLAttributes<HTMLAudioElement> & {
    src?: Attr;
    autoplay?: Attr;
    controls?: Attr;
    loop?: Attr;
    muted?: Attr;
    preload?: Attr;
    crossorigin?: Attr;
  };

  type SVGAttributes = HTMLAttributes<SVGElement> & {
    viewBox?: Attr;
    xmlns?: Attr;
    fill?: Attr;
    stroke?: Attr;
    width?: number | string;
    height?: number | string;
    d?: Attr;
    cx?: number | string;
    cy?: number | string;
    r?: number | string;
    x?: number | string;
    y?: number | string;
    x1?: number | string;
    y1?: number | string;
    x2?: number | string;
    y2?: number | string;
    points?: Attr;
    transform?: Attr;
    opacity?: number | string;
    "stroke-width"?: number | string;
    "stroke-linecap"?: Attr;
    "stroke-linejoin"?: Attr;
    "fill-rule"?: Attr;
    "clip-rule"?: Attr;
  };

  export interface IntrinsicElements {
    // Document
    html: HtmlHTMLAttributes;
    head: HTMLAttributes<HTMLHeadElement>;
    body: BodyHTMLAttributes;
    title: HTMLAttributes<HTMLTitleElement>;
    meta: MetaHTMLAttributes;
    link: LinkHTMLAttributes;
    style: StyleHTMLAttributes;
    script: ScriptHTMLAttributes;
    noscript: HTMLAttributes<globalThis.HTMLElement>;
    base: BaseHTMLAttributes;

    // Sections
    div: HTMLAttributes<HTMLDivElement>;
    span: HTMLAttributes<HTMLSpanElement>;
    p: HTMLAttributes<HTMLParagraphElement>;
    a: AnchorHTMLAttributes;
    area: AreaHTMLAttributes;
    article: HTMLAttributes<globalThis.HTMLElement>;
    aside: HTMLAttributes<globalThis.HTMLElement>;
    header: HTMLAttributes<globalThis.HTMLElement>;
    footer: HTMLAttributes<globalThis.HTMLElement>;
    main: HTMLAttributes<globalThis.HTMLElement>;
    nav: HTMLAttributes<globalThis.HTMLElement>;
    section: HTMLAttributes<globalThis.HTMLElement>;
    address: HTMLAttributes<globalThis.HTMLElement>;
    search: HTMLAttributes<globalThis.HTMLElement>;
    h1: HTMLAttributes<HTMLHeadingElement>;
    h2: HTMLAttributes<HTMLHeadingElement>;
    h3: HTMLAttributes<HTMLHeadingElement>;
    h4: HTMLAttributes<HTMLHeadingElement>;
    h5: HTMLAttributes<HTMLHeadingElement>;
    h6: HTMLAttributes<HTMLHeadingElement>;
    hgroup: HTMLAttributes<globalThis.HTMLElement>;

    // Text
    blockquote: QuoteHTMLAttributes;
    q: QuoteHTMLAttributes;
    cite: HTMLAttributes<globalThis.HTMLElement>;
    code: HTMLAttributes<globalThis.HTMLElement>;
    pre: HTMLAttributes<HTMLPreElement>;
    kbd: HTMLAttributes<globalThis.HTMLElement>;
    samp: HTMLAttributes<globalThis.HTMLElement>;
    var: HTMLAttributes<globalThis.HTMLElement>;
    mark: HTMLAttributes<globalThis.HTMLElement>;
    small: HTMLAttributes<globalThis.HTMLElement>;
    strong: HTMLAttributes<globalThis.HTMLElement>;
    em: HTMLAttributes<globalThis.HTMLElement>;
    b: HTMLAttributes<globalThis.HTMLElement>;
    i: HTMLAttributes<globalThis.HTMLElement>;
    u: HTMLAttributes<globalThis.HTMLElement>;
    s: HTMLAttributes<globalThis.HTMLElement>;
    sub: HTMLAttributes<globalThis.HTMLElement>;
    sup: HTMLAttributes<globalThis.HTMLElement>;
    abbr: HTMLAttributes<globalThis.HTMLElement> & { title?: Attr };
    dfn: HTMLAttributes<globalThis.HTMLElement>;
    time: TimeHTMLAttributes;
    data: HTMLAttributes<HTMLDataElement> & { value?: string | number };
    br: HTMLAttributes<HTMLBRElement>;
    wbr: HTMLAttributes<globalThis.HTMLElement>;
    hr: HTMLAttributes<HTMLHRElement>;

    // Lists
    ul: HTMLAttributes<HTMLUListElement>;
    ol: OlHTMLAttributes;
    li: LiHTMLAttributes;
    dl: HTMLAttributes<HTMLDListElement>;
    dt: HTMLAttributes<globalThis.HTMLElement>;
    dd: HTMLAttributes<globalThis.HTMLElement>;
    menu: HTMLAttributes<HTMLMenuElement>;

    // Tables
    table: TableHTMLAttributes;
    caption: HTMLAttributes<HTMLTableCaptionElement>;
    thead: HTMLAttributes<HTMLTableSectionElement>;
    tbody: HTMLAttributes<HTMLTableSectionElement>;
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    tr: HTMLAttributes<HTMLTableRowElement>;
    th: ThHTMLAttributes;
    td: TdHTMLAttributes;
    col: HTMLAttributes<HTMLTableColElement> & { span?: number | string };
    colgroup: HTMLAttributes<HTMLTableColElement> & { span?: number | string };

    // Forms
    form: FormHTMLAttributes;
    label: LabelHTMLAttributes;
    input: InputHTMLAttributes;
    button: ButtonHTMLAttributes;
    select: SelectHTMLAttributes;
    option: OptionHTMLAttributes;
    optgroup: OptgroupHTMLAttributes;
    textarea: TextareaHTMLAttributes;
    fieldset: FieldsetHTMLAttributes;
    legend: HTMLAttributes<HTMLLegendElement>;
    datalist: HTMLAttributes<HTMLDataListElement>;
    output: OutputHTMLAttributes;
    progress: ProgressHTMLAttributes;
    meter: MeterHTMLAttributes;

    // Media
    img: ImgHTMLAttributes;
    picture: HTMLAttributes<HTMLPictureElement>;
    source: SourceHTMLAttributes;
    video: VideoHTMLAttributes;
    audio: AudioHTMLAttributes;
    track: TrackHTMLAttributes;
    map: MapHTMLAttributes;
    canvas: CanvasHTMLAttributes;
    figure: HTMLAttributes<globalThis.HTMLElement>;
    figcaption: HTMLAttributes<globalThis.HTMLElement>;

    // Embedded
    iframe: IframeHTMLAttributes;
    embed: EmbedHTMLAttributes;
    object: ObjectHTMLAttributes;
    param: HTMLAttributes<HTMLParamElement> & { name?: Attr; value?: Attr };

    // Interactive
    details: DetailsHTMLAttributes;
    summary: HTMLAttributes<globalThis.HTMLElement>;
    dialog: DialogHTMLAttributes;
    slot: HTMLAttributes<HTMLSlotElement> & { name?: Attr };
    template: HTMLAttributes<HTMLTemplateElement>;

    // SVG (common roots / shapes)
    svg: SVGAttributes;
    path: SVGAttributes;
    circle: SVGAttributes;
    ellipse: SVGAttributes;
    rect: SVGAttributes;
    line: SVGAttributes;
    polyline: SVGAttributes;
    polygon: SVGAttributes;
    g: SVGAttributes;
    defs: SVGAttributes;
    use: SVGAttributes & { href?: Attr };
    symbol: SVGAttributes;
    text: SVGAttributes;
    tspan: SVGAttributes;
    clipPath: SVGAttributes;
    mask: SVGAttributes;
    linearGradient: SVGAttributes;
    radialGradient: SVGAttributes;
    stop: SVGAttributes & {
      offset?: Attr;
      "stop-color"?: Attr;
      "stop-opacity"?: Attr;
    };

    // Custom elements / unknown tags (`ilha-count`, etc.).
    // Wide catch-all so per-tag attribute bags stay assignable.
    [tag: string]: HTMLAttributes<HTMLElement>;
  }
}
