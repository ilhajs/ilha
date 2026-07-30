import type {
  NativeEventHandler,
  NativeEventModifier,
  RawHtml,
  SignalAccessor,
  SignalWriter,
} from "./index";

export namespace JSX {
  export type Child = unknown;
  export type ElementType = string | ((props: any) => any);

  export interface Element extends RawHtml {}

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes {
    key?: string | number;
  }

  type ClassValue = string | unknown[] | Record<string, boolean>;
  type Booleanish = boolean | "true" | "false";
  type Numberish = number | `${number}`;
  type BindAccessor<T> = SignalAccessor<any> & (() => T);
  type ElementRefAccessor<T extends globalThis.Element> = SignalWriter<T | null> & {
    (): unknown;
    select: SignalAccessor<any>["select"];
  };

  type IntrinsicEventHandlers<T extends globalThis.Element> = {
    [K in keyof HTMLElementEventMap as `on${K}`]?: NativeEventHandler<
      HTMLElementEventMap[K] & { readonly currentTarget: T }
    >;
  };

  type ModifiedIntrinsicEventHandlers<T extends globalThis.Element> = {
    [K in keyof HTMLElementEventMap as `on${K}:${NativeEventModifier}`]?: NativeEventHandler<
      HTMLElementEventMap[K] & { readonly currentTarget: T }
    >;
  };

  type StyleProps = {
    [K in keyof CSSStyleDeclaration as K extends string
      ? K extends "cssText" | "cssFloat" | "length" | "parentRule"
        ? never
        : CSSStyleDeclaration[K] extends string
          ? K
          : never
      : never]?: string | number | null;
  } & {
    float?: string | number | null;
  } & {
    [K in `--${string}`]?: string | number | null;
  };

  type DataAttributes = {
    [K in `data-${string}`]?: unknown;
  };

  interface AriaAttributes {
    "aria-activedescendant"?: string;
    "aria-atomic"?: Booleanish;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both";
    "aria-braillelabel"?: string;
    "aria-brailleroledescription"?: string;
    "aria-busy"?: Booleanish;
    "aria-checked"?: Booleanish | "mixed";
    "aria-colcount"?: Numberish;
    "aria-colindex"?: Numberish;
    "aria-colindextext"?: string;
    "aria-colspan"?: Numberish;
    "aria-controls"?: string;
    "aria-current"?: Booleanish | "page" | "step" | "location" | "date" | "time";
    "aria-describedby"?: string;
    "aria-description"?: string;
    "aria-details"?: string;
    "aria-disabled"?: Booleanish;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup";
    "aria-errormessage"?: string;
    "aria-expanded"?: Booleanish;
    "aria-flowto"?: string;
    "aria-grabbed"?: Booleanish;
    "aria-haspopup"?: Booleanish | "menu" | "listbox" | "tree" | "grid" | "dialog";
    "aria-hidden"?: Booleanish;
    "aria-invalid"?: Booleanish | "grammar" | "spelling";
    "aria-keyshortcuts"?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-level"?: Numberish;
    "aria-live"?: "off" | "assertive" | "polite";
    "aria-modal"?: Booleanish;
    "aria-multiline"?: Booleanish;
    "aria-multiselectable"?: Booleanish;
    "aria-orientation"?: "horizontal" | "vertical";
    "aria-owns"?: string;
    "aria-placeholder"?: string;
    "aria-posinset"?: Numberish;
    "aria-pressed"?: Booleanish | "mixed";
    "aria-readonly"?: Booleanish;
    "aria-relevant"?:
      | "additions"
      | "additions removals"
      | "additions text"
      | "all"
      | "removals"
      | "removals additions"
      | "removals text"
      | "text"
      | "text additions"
      | "text removals";
    "aria-required"?: Booleanish;
    "aria-roledescription"?: string;
    "aria-rowcount"?: Numberish;
    "aria-rowindex"?: Numberish;
    "aria-rowindextext"?: string;
    "aria-rowspan"?: Numberish;
    "aria-selected"?: Booleanish;
    "aria-setsize"?: Numberish;
    "aria-sort"?: "none" | "ascending" | "descending" | "other";
    "aria-valuemax"?: Numberish;
    "aria-valuemin"?: Numberish;
    "aria-valuenow"?: Numberish;
    "aria-valuetext"?: string;
  }

  export interface HTMLAttributes<T extends globalThis.Element>
    extends
      AriaAttributes,
      DataAttributes,
      IntrinsicEventHandlers<T>,
      ModifiedIntrinsicEventHandlers<T> {
    children?: Child;
    key?: string | number;
    id?: string;
    class?: ClassValue;
    className?: ClassValue;
    style?: string | StyleProps;
    accesskey?: string;
    accessKey?: string;
    autocapitalize?: string;
    autoCapitalize?: string;
    autofocus?: boolean;
    autoFocus?: boolean;
    contenteditable?: Booleanish | "inherit" | "plaintext-only";
    contentEditable?: Booleanish | "inherit" | "plaintext-only";
    dir?: "ltr" | "rtl" | "auto";
    draggable?: Booleanish;
    enterkeyhint?: string;
    enterKeyHint?: string;
    hidden?: boolean | "until-found";
    inert?: boolean;
    inputmode?: string;
    inputMode?: string;
    is?: string;
    itemid?: string;
    itemId?: string;
    itemprop?: string;
    itemProp?: string;
    itemref?: string;
    itemRef?: string;
    itemscope?: boolean;
    itemScope?: boolean;
    itemtype?: string;
    itemType?: string;
    lang?: string;
    nonce?: string;
    part?: string;
    popover?: "auto" | "hint" | "manual" | string;
    role?: string;
    slot?: string;
    spellcheck?: Booleanish;
    spellCheck?: Booleanish;
    tabindex?: Numberish;
    tabIndex?: number;
    title?: string;
    translate?: "yes" | "no";
    "bind:this"?: ElementRefAccessor<T>;
    constructor?: unknown;
    __proto__?: unknown;
  }

  interface AnchorAttributes {
    download?: string | boolean;
    href?: string;
    hreflang?: string;
    hrefLang?: string;
    ping?: string;
    referrerpolicy?: string;
    referrerPolicy?: string;
    rel?: string;
    target?: string;
    type?: string;
  }

  interface MediaAttributes {
    autoplay?: boolean;
    autoPlay?: boolean;
    controls?: boolean;
    crossorigin?: string;
    crossOrigin?: string;
    loop?: boolean;
    muted?: boolean;
    preload?: "none" | "metadata" | "auto" | string;
    src?: string;
  }

  interface FormTargetAttributes {
    form?: string;
    formaction?: string;
    formAction?: string;
    formenctype?: string;
    formEncType?: string;
    formmethod?: string;
    formMethod?: string;
    formnovalidate?: boolean;
    formNoValidate?: boolean;
    formtarget?: string;
    formTarget?: string;
  }

  interface InputAttributes extends FormTargetAttributes {
    accept?: string;
    alt?: string;
    autocomplete?: string;
    autoComplete?: string;
    capture?: boolean | "user" | "environment";
    checked?: boolean;
    dirname?: string;
    disabled?: boolean;
    height?: Numberish;
    list?: string;
    max?: string | number;
    maxlength?: Numberish;
    maxLength?: number;
    min?: string | number;
    minlength?: Numberish;
    minLength?: number;
    multiple?: boolean;
    name?: string;
    pattern?: string;
    placeholder?: string;
    readonly?: boolean;
    readOnly?: boolean;
    required?: boolean;
    size?: Numberish;
    src?: string;
    step?: string | number;
    type?:
      | "button"
      | "checkbox"
      | "color"
      | "date"
      | "datetime-local"
      | "email"
      | "file"
      | "hidden"
      | "image"
      | "month"
      | "number"
      | "password"
      | "radio"
      | "range"
      | "reset"
      | "search"
      | "submit"
      | "tel"
      | "text"
      | "time"
      | "url"
      | "week";
    value?: string | number;
    width?: Numberish;
    "bind:value"?: BindAccessor<string | number>;
    "bind:valueAsNumber"?: BindAccessor<number | null>;
    "bind:valueAsDate"?: BindAccessor<Date | null>;
    "bind:checked"?: BindAccessor<boolean>;
    "bind:group"?: BindAccessor<string | number | Array<string | number>>;
    "bind:files"?: BindAccessor<FileList | null>;
  }

  interface TextareaAttributes {
    autocomplete?: string;
    autoComplete?: string;
    cols?: Numberish;
    dirname?: string;
    disabled?: boolean;
    form?: string;
    maxlength?: Numberish;
    maxLength?: number;
    minlength?: Numberish;
    minLength?: number;
    name?: string;
    placeholder?: string;
    readonly?: boolean;
    readOnly?: boolean;
    required?: boolean;
    rows?: Numberish;
    wrap?: "hard" | "soft" | "off";
    "bind:value"?: BindAccessor<string | number>;
  }

  interface SelectAttributes {
    autocomplete?: string;
    autoComplete?: string;
    disabled?: boolean;
    form?: string;
    multiple?: boolean;
    name?: string;
    required?: boolean;
    size?: Numberish;
    "bind:value"?: BindAccessor<string | number>;
  }

  interface ButtonAttributes extends FormTargetAttributes {
    disabled?: boolean;
    name?: string;
    type?: "button" | "reset" | "submit";
    value?: string | number;
  }

  interface ImgAttributes {
    alt?: string;
    crossorigin?: string;
    crossOrigin?: string;
    decoding?: "async" | "auto" | "sync";
    fetchpriority?: "high" | "low" | "auto";
    fetchPriority?: "high" | "low" | "auto";
    height?: Numberish;
    ismap?: boolean;
    isMap?: boolean;
    loading?: "eager" | "lazy";
    referrerpolicy?: string;
    referrerPolicy?: string;
    sizes?: string;
    src?: string;
    srcset?: string;
    srcSet?: string;
    usemap?: string;
    useMap?: string;
    width?: Numberish;
  }

  interface FormAttributes {
    "accept-charset"?: string;
    acceptCharset?: string;
    action?: string;
    autocomplete?: "on" | "off";
    autoComplete?: "on" | "off";
    enctype?: string;
    encType?: string;
    method?: "dialog" | "get" | "post" | string;
    name?: string;
    novalidate?: boolean;
    noValidate?: boolean;
    rel?: string;
    target?: string;
  }

  interface ScriptAttributes {
    async?: boolean;
    crossorigin?: string;
    crossOrigin?: string;
    defer?: boolean;
    fetchpriority?: "high" | "low" | "auto";
    fetchPriority?: "high" | "low" | "auto";
    integrity?: string;
    nomodule?: boolean;
    noModule?: boolean;
    referrerpolicy?: string;
    referrerPolicy?: string;
    src?: string;
    type?: string;
  }

  interface LinkAttributes {
    as?: string;
    crossorigin?: string;
    crossOrigin?: string;
    disabled?: boolean;
    fetchpriority?: "high" | "low" | "auto";
    fetchPriority?: "high" | "low" | "auto";
    href?: string;
    hreflang?: string;
    hrefLang?: string;
    imagesizes?: string;
    imageSizes?: string;
    imagesrcset?: string;
    imageSrcSet?: string;
    integrity?: string;
    media?: string;
    referrerpolicy?: string;
    referrerPolicy?: string;
    rel?: string;
    sizes?: string;
    type?: string;
  }

  interface SourceAttributes {
    height?: Numberish;
    media?: string;
    sizes?: string;
    src?: string;
    srcset?: string;
    srcSet?: string;
    type?: string;
    width?: Numberish;
  }

  interface SVGPresentationAttributes {
    accentHeight?: Numberish;
    accumulate?: "none" | "sum";
    additive?: "replace" | "sum";
    alignmentBaseline?: string;
    baselineShift?: string | number;
    clipPath?: string;
    clipRule?: "nonzero" | "evenodd" | "inherit";
    color?: string;
    cx?: string | number;
    cy?: string | number;
    d?: string;
    direction?: "ltr" | "rtl" | "inherit";
    display?: string;
    dominantBaseline?: string;
    dx?: string | number;
    dy?: string | number;
    fill?: string;
    fillOpacity?: string | number;
    fillRule?: "nonzero" | "evenodd" | "inherit";
    filter?: string;
    filterUnits?: "objectBoundingBox" | "userSpaceOnUse";
    gradientTransform?: string;
    gradientUnits?: "objectBoundingBox" | "userSpaceOnUse";
    floodColor?: string;
    floodOpacity?: string | number;
    fontFamily?: string;
    fontSize?: string | number;
    fontStyle?: string;
    fontWeight?: string | number;
    height?: string | number;
    markerEnd?: string;
    markerMid?: string;
    markerStart?: string;
    markerUnits?: "strokeWidth" | "userSpaceOnUse";
    mask?: string;
    offset?: string | number;
    opacity?: string | number;
    orient?: string | number;
    pathLength?: string | number;
    patternContentUnits?: "objectBoundingBox" | "userSpaceOnUse";
    patternTransform?: string;
    patternUnits?: "objectBoundingBox" | "userSpaceOnUse";
    points?: string;
    preserveAspectRatio?: string;
    primitiveUnits?: "objectBoundingBox" | "userSpaceOnUse";
    refX?: string | number;
    refY?: string | number;
    r?: string | number;
    rx?: string | number;
    ry?: string | number;
    stdDeviation?: string | number;
    stopColor?: string;
    stopOpacity?: string | number;
    spreadMethod?: "pad" | "reflect" | "repeat";
    stroke?: string;
    strokeDasharray?: string | number;
    strokeDashoffset?: string | number;
    strokeLinecap?: "butt" | "round" | "square" | "inherit";
    strokeLinejoin?: "arcs" | "bevel" | "miter" | "miter-clip" | "round" | "inherit";
    strokeMiterlimit?: string | number;
    strokeOpacity?: string | number;
    strokeWidth?: string | number;
    textAnchor?: "start" | "middle" | "end" | "inherit";
    transform?: string;
    vectorEffect?: string;
    viewBox?: string;
    visibility?: string;
    width?: string | number;
    x?: string | number;
    x1?: string | number;
    x2?: string | number;
    href?: string;
    "xlink:href"?: string;
    xlinkHref?: string;
    xmlns?: string;
    y?: string | number;
    y1?: string | number;
    y2?: string | number;
  }

  type HtmlSpecificAttributes = {
    a: AnchorAttributes;
    area: AnchorAttributes & { alt?: string; coords?: string; shape?: string };
    audio: MediaAttributes;
    base: Pick<AnchorAttributes, "href" | "target">;
    blockquote: { cite?: string };
    button: ButtonAttributes & {
      popovertarget?: string;
      popoverTarget?: string;
      popovertargetaction?: "hide" | "show" | "toggle";
      popoverTargetAction?: "hide" | "show" | "toggle";
    };
    canvas: { height?: Numberish; width?: Numberish };
    col: { span?: Numberish };
    colgroup: { span?: Numberish };
    data: { value?: string | number };
    del: { cite?: string; datetime?: string; dateTime?: string };
    details: { open?: boolean; name?: string; "bind:open"?: BindAccessor<boolean> };
    dialog: { open?: boolean; closedby?: string };
    embed: { height?: Numberish; src?: string; type?: string; width?: Numberish };
    fieldset: { disabled?: boolean; form?: string; name?: string };
    form: FormAttributes;
    iframe: {
      allow?: string;
      allowfullscreen?: boolean;
      allowFullScreen?: boolean;
      height?: Numberish;
      loading?: "eager" | "lazy";
      name?: string;
      referrerpolicy?: string;
      referrerPolicy?: string;
      sandbox?: string;
      src?: string;
      srcdoc?: string;
      srcDoc?: string;
      width?: Numberish;
    };
    img: ImgAttributes;
    input: InputAttributes & {
      popovertarget?: string;
      popoverTarget?: string;
      popovertargetaction?: "hide" | "show" | "toggle";
      popoverTargetAction?: "hide" | "show" | "toggle";
    };
    ins: { cite?: string; datetime?: string; dateTime?: string };
    label: { for?: string; htmlFor?: string };
    li: { value?: number };
    link: LinkAttributes;
    map: { name?: string };
    meta: {
      charset?: string;
      charSet?: string;
      content?: string;
      "http-equiv"?: string;
      httpEquiv?: string;
      name?: string;
    };
    meter: {
      high?: Numberish;
      low?: Numberish;
      max?: Numberish;
      min?: Numberish;
      optimum?: Numberish;
      value?: Numberish;
    };
    object: {
      data?: string;
      form?: string;
      height?: Numberish;
      name?: string;
      type?: string;
      usemap?: string;
      useMap?: string;
      width?: Numberish;
    };
    ol: { reversed?: boolean; start?: Numberish; type?: "1" | "a" | "A" | "i" | "I" };
    optgroup: { disabled?: boolean; label?: string };
    option: { disabled?: boolean; label?: string; selected?: boolean; value?: string | number };
    output: { for?: string; form?: string; name?: string };
    progress: { max?: Numberish; value?: Numberish };
    q: { cite?: string };
    script: ScriptAttributes;
    select: SelectAttributes;
    slot: { name?: string };
    source: SourceAttributes;
    style: { media?: string; title?: string; type?: string };
    td: {
      colspan?: Numberish;
      colSpan?: number;
      headers?: string;
      rowspan?: Numberish;
      rowSpan?: number;
    };
    textarea: TextareaAttributes;
    th: {
      abbr?: string;
      colspan?: Numberish;
      colSpan?: number;
      headers?: string;
      rowspan?: Numberish;
      rowSpan?: number;
      scope?: "col" | "colgroup" | "row" | "rowgroup";
    };
    time: { datetime?: string; dateTime?: string };
    track: {
      default?: boolean;
      kind?: "captions" | "chapters" | "descriptions" | "metadata" | "subtitles";
      label?: string;
      src?: string;
      srclang?: string;
      srcLang?: string;
    };
    video: MediaAttributes & {
      height?: Numberish;
      playsinline?: boolean;
      playsInline?: boolean;
      poster?: string;
      width?: Numberish;
    };
  };

  /** `raw()` is valid anywhere JSX would otherwise accept a string attribute. */
  type WithRawHtmlAttributeValues<T> = {
    [K in keyof T]: T[K] | (Extract<T[K], string> extends never ? never : RawHtml);
  };

  export type IntrinsicElementProps<T extends globalThis.Element = HTMLElement> =
    WithRawHtmlAttributeValues<HTMLAttributes<T>>;

  type HtmlIntrinsicElements = {
    [K in keyof HTMLElementTagNameMap]: WithRawHtmlAttributeValues<
      HTMLAttributes<HTMLElementTagNameMap[K]> &
        (K extends keyof HtmlSpecificAttributes ? HtmlSpecificAttributes[K] : {})
    >;
  };

  type SvgOnlyIntrinsicElements = {
    [K in Exclude<
      keyof SVGElementTagNameMap,
      keyof HTMLElementTagNameMap
    >]: WithRawHtmlAttributeValues<
      HTMLAttributes<SVGElementTagNameMap[K]> & SVGPresentationAttributes
    >;
  };

  type SvgOverlapAttributes = {
    [K in Extract<
      keyof SVGElementTagNameMap,
      keyof HTMLElementTagNameMap
    >]: WithRawHtmlAttributeValues<SVGPresentationAttributes>;
  };

  type CustomEventAttributes<T extends globalThis.Element> = {
    [K in `on${string}`]?: NativeEventHandler<Event & { readonly currentTarget: T }>;
  };

  export interface CustomElementAttributes extends HTMLAttributes<HTMLElement> {
    [name: string]: unknown;
  }

  type CustomIntrinsicElements = {
    [K in `${string}-${string}`]: CustomElementAttributes & CustomEventAttributes<HTMLElement>;
  };

  export type IntrinsicElements = HtmlIntrinsicElements &
    SvgOnlyIntrinsicElements &
    SvgOverlapAttributes &
    CustomIntrinsicElements;
}
